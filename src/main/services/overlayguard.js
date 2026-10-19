'use strict';
/**
 * 发布链路共享的弹层守卫。
 *
 * 入口相机、普通步骤、转场都必须走这一处，避免同一类遮罩在不同流程各写一套判断。
 * 只认有独立弹层身份（Dialog / PopupWindow / alertTitle），或无类名但“居中标题
 * + 明确关闭按钮 / 全屏遮罩”的可见组合；普通 RecyclerView / ViewGroup / FrameLayout
 * 无论多大、无论它是否压住点击点，都不是遮罩。
 */
const entrydialogs = require('./entrydialogs');
const adb = require('./adb');

function screenOf(nodes) {
  return (nodes || []).reduce((acc, node) => {
    const box = node && node.box;
    if (!box || box.x2 <= box.x1 || box.y2 <= box.y1) return acc;
    return { w: Math.max(acc.w, box.x2), h: Math.max(acc.h, box.y2) };
  }, { w: 0, h: 0 });
}

function visible(node) {
  return !!(node && node.box && node.box.x2 > node.box.x1 && node.box.y2 > node.box.y1);
}

function label(node) {
  return String((node && (node.text || node.desc)) || '').trim();
}

function contains(box, point) {
  return !!(box && point && box.x1 <= point.x && point.x <= box.x2
    && box.y1 <= point.y && point.y <= box.y2);
}

function insideBox(inner, outer) {
  return !!(inner && outer && inner.x1 >= outer.x1 && inner.y1 >= outer.y1
    && inner.x2 <= outer.x2 && inner.y2 <= outer.y2);
}

function areaOf(box) {
  return box && box.x2 > box.x1 && box.y2 > box.y1
    ? (box.x2 - box.x1) * (box.y2 - box.y1) : 0;
}

/**
 * 弹窗“存在”不等于“挡住本次点击”。
 *
 * 发布页可能常驻“创作分析”一类可折叠面板，它有 Dialog/PopupWindow 身份和自己的
 * 关闭按钮，但目标仍在面板外，点击本来就能命中。关掉它反而会让下游坐标整体移动，
 * 造成后续找不到按钮。
 *
 * 只有以下两种情况才允许关闭：
 *   1. 目标点击点确实落在弹层容器内；
 *   2. 弹层容器本身覆盖整屏（独立 Android Dialog 的全屏 window 或全屏 scrim）。
 * 没有目标的预清理只接受第 2 种，绝不因为“页面上有颗关闭按钮”就动页面布局。
 */
function blocksTarget(nodes, found, target) {
  const cover = found && found.node;
  if (!visible(cover)) return false;
  const screen = screenOf(nodes);
  if (!screen.w || !screen.h) return false;
  if (contains(cover.box, target && target.center)) return true;
  if (found.fullScreenScrim && contains(found.fullScreenScrim.box, target && target.center)) return true;
  // Android Dialog 是独立模态 Window：居中内容框不覆盖目标，点击也会先落到
  // Dialog 自己的 Window 上。只有 Dialog/alertTitle 具备这个窗口语义；
  // 页内 PopupWindow（如“创作分析”）仍必须按几何位置判断，不能一刀切关闭。
  if (found.windowOwnsScreen && !found.overlapsTarget) return true;
  return areaOf(cover.box) >= areaOf({
    x1: 0, y1: 0, x2: screen.w, y2: screen.h
  }) * 0.9;
}

/** 正常加载文字是否真的盖在当前点击点上，而不是页面别处的内容。 */
function loadingOverTarget(nodes, target) {
  if (entrydialogs.publishingOver(nodes, target)) return true;
  if (!target || !target.center) return false;
  const loading = (nodes || []).filter(n =>
    entrydialogs.visibleLoading(n) && contains(n.box, target.center));
  if (!loading.length) return false;
  const modal = entrydialogs.inspectModal(nodes, target, { allowLoading: true });
  if (modal && modal.node) return true;
  const screen = screenOf(nodes);
  return loading.some(n => areaOf(n.box) >= areaOf({
    x1: 0, y1: 0, x2: screen.w, y2: screen.h
  }) * 0.25);
}

/** 弹窗外的安全坐标；clickable=false 的遮罩也允许按坐标尝试。 */
function outsidePoint(nodes, overlay, target) {
  const screen = screenOf(nodes);
  const box = visible(overlay) ? overlay.box : null;
  if (!box) return null;
  const area = (box.x2 - box.x1) * (box.y2 - box.y1);
  const inner = (nodes || []).filter(node => {
    if (!visible(node) || node === overlay) return false;
    const b = node.box;
    return Math.abs((b.x1 + b.x2) / 2 - screen.w / 2) < screen.w * 0.2
      && (b.x2 - b.x1) * (b.y2 - b.y1) < area * 0.9
      && !contains(b, target && target.center);
  }).sort((a, b) =>
    (b.box.x2 - b.box.x1) * (b.box.y2 - b.box.y1)
    - (a.box.x2 - a.box.x1) * (a.box.y2 - a.box.y1))[0];
  const x = Math.round(screen.w / 2);
  if (inner) {
    const b = inner.box;
    return [
      { x, y: b.y1 > 60 ? b.y1 - 30 : Math.min(screen.h - 10, b.y2 + 30) },
      { x, y: Math.round(screen.h * 0.08) }
    ];
  }
  return [
    { x, y: Math.round(screen.h * 0.08) },
    { x: Math.round(screen.w * 0.08), y: Math.round(screen.h * 0.5) }
  ];
}

/** 云端失败原因只保留必要字段，且限长。 */
function evidence(nodes, overlay, target) {
  const clip = (value, length) => {
    const text = String(value || '');
    return text.length > length ? text.slice(0, Math.max(0, length - 1)) + '…' : text;
  };
  const cover = overlay || null;
  const inside = (nodes || []).filter(node =>
    visible(node) && node !== cover && cover && insideBox(node.box, cover.box));
  const buttons = inside.filter(node =>
    node.clickable || /(?:^|:id\/)(?:btn|button|iv_?close|tvCancel|tv_?close|close)/i.test(String(node.id || '')))
    .slice(0, 6)
    .map(node => `${clip(label(node) || '无文字', 18)}${node.clickable ? '·可点' : '·不可点'}`
      + `(${clip(node.id || node.cls || '无id', 42)},${clip(node.bounds || '-', 28)})`);
  const content = inside.filter(node => label(node)).slice(0, 8).map(node => clip(label(node), 28));
  const bounds = cover && cover.box
    ? `[${cover.box.x1},${cover.box.y1}][${cover.box.x2},${cover.box.y2}]`
    : String((cover && cover.bounds) || '-');
  const targetAt = target && target.center ? `${target.center.x},${target.center.y}` : '-';
  return clip(`遮罩=${clip(cover && cover.pkg || '-', 48)}/${clip(cover && (cover.id || cover.cls) || '无id', 64)}`
    + `${bounds}; 目标=${targetAt}; 文字=${content.join(' / ') || '无可读文字'}; `
    + `按钮=${buttons.join(' / ') || '无按钮'}`, 420);
}

/**
 * 明确弹层：优先 Dialog/PopupWindow/alertTitle 的系统识别；
 * 没有显式类名时，只接受“大遮罩 + 关闭按钮”的组合。
 */
function explicit(nodes, target) {
  return entrydialogs.inspectModal(nodes, target);
}

/**
 * 目标点击点上的遮挡。普通容器绝不参与；只有明确弹层才可能挡路。
 * 弹层可以不盖住目标中心（屏幕正中的活动弹窗也会吞掉整屏点击），
 * 但必须由 inspectModal 给出弹层身份；overTarget 不再按面积猜弹窗。
 */
function overTarget(nodes, target) {
  // 正常导出/上传遮罩不是“可清理弹窗”。即使它带 Dialog 壳，也只等它结束；
  // 不点外侧、不记录失败。
  if (loadingOverTarget(nodes, target)) return null;
  const modal = explicit(nodes, target);
  if (!modal || !modal.node) return null;
  // 有弹窗身份/关闭按钮，但目标在它外面且它不覆盖整屏 ⇒ 这是页内面板，不是遮罩。
  if (!blocksTarget(nodes, modal, target)) return null;
  const cover = modal.node;
  const container = modal.container || cover;
  return {
    cover,
    container,
    close: modal.button || null,
    name: modal.name || label(cover) || cover.id || cover.cls || '页面弹窗',
    fullScreenScrim: modal.fullScreenScrim || null,
    windowOwnsScreen: !!modal.windowOwnsScreen
  };
}

/** 找到当前屏上应该先关掉的明确弹层；返回 null 表示没有。 */
function blocking(nodes, target) {
  if (loadingOverTarget(nodes, target)) return null;
  const modal = explicit(nodes, target);
  return modal && modal.node && blocksTarget(nodes, modal, target) ? modal : null;
}

function unclosedError(step, found) {
  const error = new Error(`${step && step.name || '当前步骤'}：遮罩「${found.name}」的关闭入口和外侧点击均未生效，`
    + '未点击目标；本条失败并保留现场');
  error.code = 'PUBLISH_OVERLAY_UNCLOSED';
  return error;
}

function blockedError(nodes, step) {
  const modal = blocking(nodes, step && step.center ? step : null);
  if (!modal) return null;
  const error = new Error(`${step && step.name || step.value || '当前步骤'}：目标被弹窗「${modal.name || '页面弹窗'}」遮住；`
    + evidence(nodes, modal.node, { center: modal.node.center || null }));
  error.code = 'PUBLISH_OVERLAY_BLOCKS_TARGET';
  return error;
}

/**
 * 如果这一屏有明确弹窗，优先点它自己的关闭按钮；没有关闭按钮才点弹窗外侧。
 * 返回 true 表示已经发生了关闭动作，调用方必须重新观测页面。
 * 同一片弹窗最多点两次外侧；仍关不掉就抛行级错误，让该条失败但批次继续。
 */
async function dismiss(serial, nodes, ctx, step, target) {
  const found = overTarget(nodes, target);
  if (!found) return false;
  // 关闭次数必须按“当前步骤 + 当前弹层”计数。只按弹层 bounds 记会让下一页
  // 复用了同一片全屏 Dialog 时沿用上一步的 closeTries，误以为“关闭已试过”
  // 而直接去点外侧，最终把一条本来可自动恢复的内容判失败。
  const stepKey = `${step && (step.name || step.action || '')}|${step && (step.value || '')}`;
  const key = `${stepKey}|${found.container && (found.container.id || found.container.cls)}|`
    + `${found.container && found.container.bounds}`;
  // 同一个弹层在“先预判再点”的路径里，会被入口预判和真正点击前的守卫各看到一次。
  // 若按步骤重新计数，同一颗关闭按钮会被连点多次；关闭动作本身又会让下游坐标移动。
  // 因此关闭尝试按“弹层身份”共享，只有外侧点击仍按步骤限次（最多 2 次）。
  // 点完后若弹层仍在，外层会重新抓屏；这里只负责每个弹层最多一次明确关闭。
  const state = ctx._overlayGuard || (ctx._overlayGuard = {
    key: '', tries: 0, closeKey: '', closeTries: 0
  });
  // 明确关闭按“这一步的点击目标 + 弹层身份”共享：同一轮预判和真正点击前会
  // 连续看到同一片弹层，不能把关闭按钮连点两次；但进入下一屏后，即使复用
  // 同样大小/同样 id 的弹窗，也不过是另一个弹层实例，必须重新允许关闭一次。
  const targetKey = target && target.center
    ? `${Math.round(target.center.x)},${Math.round(target.center.y)}` : '-';
  const closeKey = `${found.container && (found.container.id || found.container.cls)}|`
    + `${found.container && found.container.bounds}|${targetKey}`;
  // 按弹层身份跨步骤共享“已点过一次明确关闭”。仅当同一身份仍停留超过
  // 一个完整观察周期时，才允许第二次尝试；否则同一轮预判+点击会把关闭
  // 按钮连点两次。状态以“身份 + 时间窗”为键。
  const now = Date.now();
  if (state.closeKey !== closeKey) {
    state.closeKey = closeKey;
    state.closeTries = 0;
    state.closeAt = 0;
  }
  if (state.key !== key) {
    state.key = key;
    state.tries = 0;
  }
  // 关闭文字不可点、但同片区域里有可点容器时，优先用容器；
  // 不能用整张弹窗作为“关闭”按钮（那会点到弹窗中心，不是关闭出口）。
  const clickableClose = found.close && found.close.center
    ? (found.close.clickable ? found.close : (nodes || []).find(n =>
      n !== found.close && n !== found.cover && n.clickable && n.enabled && n.center
      && n.box && n.box.x1 <= found.close.center.x && found.close.center.x <= n.box.x2
      && n.box.y1 <= found.close.center.y && found.close.center.y <= n.box.y2) || null)
    : null;
  // 同一屏上的“预判 + 真正点击前”仍只允许一次明确关闭；但如果同一个弹层
  // 在关闭回执后**依然存在**，下一次完整观测已经证明它没关掉，就必须允许在
  // 有限次数内重试关闭。否则会把一个可恢复的弹窗直接判成行级失败。
  const closeAllowed = state.closeTries < 2
    && (state.closeTries < 1 || now - state.closeAt >= 700);
  let point = closeAllowed && clickableClose && clickableClose.center;
  let what = clickableClose
    ? (label(clickableClose) || clickableClose.id || '关闭')
    : '';
  if (!point && closeAllowed && found.close) {
    // 关闭文字自身有坐标，但只有它落在“明确弹层”范围内时才允许点文字。
    point = found.close.center;
    what = label(found.close) || found.close.id || '关闭';
  }
  if (!point && state.tries < 2) {
    point = (outsidePoint(nodes, found.container, target) || [])[state.tries];
    what = '弹窗外侧';
  }
  if (!point) {
    const error = unclosedError(step, found);
    error.message += '；' + evidence(nodes, found.cover, target);
    throw error;
  }
  if (what === '弹窗外侧') state.tries++;
  else {
    state.closeTries++;
    state.closeAt = now;
  }
  if (process.env.DEBUG_OVERLAY) {
    console.error(`[overlay] step=${stepKey} key=${key} closeKey=${closeKey} `
      + `tries=${state.tries} closeTries=${state.closeTries} what=${what} `
      + `point=${point && point.x},${point && point.y}`);
  }
  const result = await adb.tap(serial, point.x, point.y);
  if (ctx && ctx.log) {
    ctx.log(`${step && step.name || '当前步骤'}：发现弹窗「${found.name}」，先点${what} `
      + `(${point.x},${point.y}) 再点目标`, result.ok ? 'info' : 'warn');
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  return true;
}

/** 有明确弹窗时清理；没有返回 false。正常路径只做内存判断，不抓屏、不等待。 */
async function clear(serial, nodes, ctx, step, target) {
  return dismiss(serial, nodes, ctx, step, target);
}

module.exports = {
  screenOf,
  visible,
  label,
  outsidePoint,
  evidence,
  explicit,
  overTarget,
  blocking,
  dismiss,
  clear,
  unclosedError,
  blockedError,
  loadingOverTarget
};
