'use strict';
// 复用入口检查已经解析的节点；这里不抓屏、不等待、不点击。
const PKG = 'com.shizhuang.duapp';
const ownNodes = nodes => (nodes || []).filter(n => n.pkg === PKG || String(n.id || '').startsWith(PKG + ':id/'));
const label = n => String((n && (n.text || n.desc)) || '').trim();

/**
 * ★★ 发布页自己的「返回确认条」（2026-10-17 真机取证 / MuMu 12 / 得物 6.0.5）：
 *   在**有内容的发布页**上按返回，页面会在底部弹出这一条：
 *     tvTip「确定要返回编辑吗？」
 *     tvQuit「返回编辑」                          —— 不退出，回去继续编辑
 *     layoutSaveDraft 里 tvSaveDraft「保存并退出」   —— 内容存进「我-个人主页」的草稿，**不丢**
 *     tvCancel「取消」                            —— 关掉这条，留在发布页
 *
 * ★ 为什么单独认它、不复用入口那条「是否继续编辑」的规则：两条弹窗的 tvCancel **含义相反**
 *   （入口那条＝放弃旧内容；这一条＝取消退出）。按 id 复用会把「取消退出」当成「放弃」，
 *   方向完全错，最坏会把正在编辑的内容丢掉。
 * ★ 为什么只认「保存并退出」一个出口：它是**唯一**一个「内容不丢 + 又能离开发布流程」的按钮。
 *   另外两个（返回编辑／取消）都不解决卡点；绝不替用户选它们。
 * ★ 可点的是**容器**不是文字（真机 tvSaveDraft 的 clickable=false，clickable 的是
 *   layoutSaveDraft，两者同一片区域）：按文字找到它，再挑「中心点落在它身上的可点容器」。
 */
const SAVE_DRAFT_TEXT = /^(?:保存并退出|保存草稿)$/;
/**
 * 确认条自己的提示语。**必须先认出提示语**才允许去找里面的保存出口 —— 真机实测踩到：
 * 发布页底部本来就有一颗 `tvSaveExit`「存草稿」，只按文字找出口会把它当成"出口"，
 * 点下去只会存一次草稿、人还留在这一页（上面那个循环就是这么空转到超时的）。
 */
const EXIT_PROMPT_TEXT = /确定要返回编辑吗|返回编辑吗|是否保存草稿/;
/** 正在上传/发布的内容：一个键都不许碰（动了就是打断上传或误发） */
const UPLOAD_IN_FLIGHT = /正在上传|上传中|正在发布|发布中|取消上传|放弃发布/;
/**
 * 得物自己弹出的“正常处理中”遮罩（真机截图：图片编辑页 90%、
 * 「正在导出图片 / 请不要退出得物」）。它没有关闭按钮，点外侧也不会消失。
 * 这种遮罩不是错误，也不许当成普通弹窗清理，只能等它自行结束。
 */
const NORMAL_LOADING = /正在导出图片|请不要退出得物|正在处理图片|正在保存图片|图片导出中/;
const ACTIVE_PUBLISHING = /正在上传|上传中|正在发布|发布中/;

function rectOf(node) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(String((node && node.bounds) || ''));
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

/** 这一屏上有没有正在上传/发布的内容 */
function hasUploadInFlight(nodes) {
  return ownNodes(nodes).some(n => UPLOAD_IN_FLIGHT.test(label(n)));
}

/** 当前屏是否处于正常加载/导出/上传遮罩中。 */
function hasNormalLoading(nodes) {
  return (nodes || []).some(n => shownNode(n) && NORMAL_LOADING.test(label(n)));
}

/**
 * 正常加载是否确实构成“遮罩”，而不是页面别处残留的一行历史文字。
 * 全屏加载层；或加载文字外面套着 Dialog/PopupWindow；或加载文字自身覆盖目标点。
 */
function loadingOver(nodes, target) {
  const all = Array.isArray(nodes) ? nodes : [];
  const loading = all.filter(visibleLoading);
  if (!loading.length) return false;
  const screen = all.reduce((acc, n) => {
    const b = n && n.box;
    if (!b || b.x2 <= b.x1 || b.y2 <= b.y1) return acc;
    return { w: Math.max(acc.w, b.x2), h: Math.max(acc.h, b.y2) };
  }, { w: 0, h: 0 });
  const full = n => n.box && n.box.x1 <= 0 && n.box.y1 <= 0
    && n.box.x2 >= screen.w * 0.98 && n.box.y2 >= screen.h * 0.98;
  const inModal = n => all.some(m => m !== n && shownNode(m) && full(m)
    && (/Dialog$|PopupWindow$/.test(String(m.cls || '')) || m.id === 'android:id/alertTitle'));
  const covers = n => !!(target && target.center && n.box
    && n.box.x1 <= target.center.x && target.center.x <= n.box.x2
    && n.box.y1 <= target.center.y && target.center.y <= n.box.y2);
  if (loading.some(n => full(n) || inModal(n) || covers(n))) return true;
  // 真机导出遮罩是“两张居中的加载文字叠在当前屏上”，文字块本身常不覆盖
  // 底下的按钮。只有同一组至少两条居中且相邻的加载文字才视为遮罩，
  // 避免把页面别处一条历史文案当成整页正在处理。
  return loading.some((a, i) => loading.some((b, j) => {
    if (i >= j || !a.box || !b.box) return false;
    const center = box => (box.x1 + box.x2) / 2;
    const sameColumn = Math.abs(center(a.box) - center(b.box)) <= screen.w * 0.1;
    const gap = Math.max(a.box.y1, b.box.y1) - Math.min(a.box.y2, b.box.y2);
    return sameColumn && gap >= -20 && gap <= screen.h * 0.12;
  }));
}

function hasActivePublishing(nodes) {
  return (nodes || []).some(n => shownNode(n)
    && ACTIVE_PUBLISHING.test(label(n))
    && !NORMAL_LOADING.test(label(n)));
}

/**
 * 动态流/发布页上的“正在上传/发布”遮罩：文字类状态，或覆盖在目标点上的可见进度条。
 * 上传中绝不点相机、重试或返回；只能等它自行结束。
 */
function publishingOver(nodes, target) {
  const all = Array.isArray(nodes) ? nodes : [];
  if (!target || !target.center) return false;
  return all.some(n => shownNode(n)
    && (ACTIVE_PUBLISHING.test(label(n)) || /(?:^|\.)ProgressBar$/.test(String(n.cls || '')))
    // 页面自带的加载圈并非上传态；只有同时存在上传/发布文案才按上传处理。
    && ACTIVE_PUBLISHING.test(all.map(x => label(x)).join(' '))
    && n.box.x1 <= target.center.x && target.center.x <= n.box.x2
    && n.box.y1 <= target.center.y && target.center.y <= n.box.y2);
}

function shownNode(n) {
  return !!(n && n.box && n.box.x2 > n.box.x1 && n.box.y2 > n.box.y1);
}

function visibleLoading(n) {
  return shownNode(n) && NORMAL_LOADING.test(label(n));
}

/** 发布页返回确认条的「保存并退出」；认不出来 ⇒ null（不认识＝不许猜着点） */
function inspectPublishExit(nodes) {
  const all = ownNodes(nodes);
  if (!all.length) return null;
  const prompt = all.find(n => EXIT_PROMPT_TEXT.test(label(n)));
  if (!prompt) return null;
  const textNode = all.find(n => SAVE_DRAFT_TEXT.test(label(n)) && n.center);
  if (!textNode) return null;
  const rect = rectOf(textNode);
  let container = null;
  if (rect) {
    container = all.find(n => {
      if (n === textNode || !n.clickable || !n.center) return false;
      const r = rectOf(n);
      return !!r && r.x1 <= textNode.center.x && textNode.center.x <= r.x2
        && r.y1 <= textNode.center.y && textNode.center.y <= r.y2;
    }) || null;
  }
  return { kind: 'save-draft', name: label(textNode), button: container || textNode };
}

const RULES = [
  { name: '版本更新邀请', titles: ['发现新版本', '版本更新'], buttons: ['取消', '暂不更新', '以后再说', '稍后再说', '关闭'] },
  { name: '通知开启邀请', titles: ['开启通知', '开启消息通知', '通知权限'], buttons: ['取消', '暂不开启', '以后再说', '稍后再说', '暂不', '关闭'] }
];

function inspect(nodes) {
  nodes = Array.isArray(nodes) ? nodes : [];
  const own = nodes.filter(n => n.pkg === PKG || n.id.startsWith(PKG + ':id/'));
  const text = n => (n.text || n.desc || '').trim();
  const explicitClose = n => /^(关闭|×|✕|Close)$/i.test(text(n))
    || /:id\/(?:iv_?close|btn_?close|dialog_?close|close(?:_?button)?)$/i.test(n.id);
  const usable = n => n.enabled && n.clickable && n.center;
  // 优先明确关闭，其次按离弹窗标题的距离排序；同距离使用页面中靠后的节点。
  const pick = (buttons, title) => buttons.sort((a,b) => Number(explicitClose(b))-Number(explicitClose(a))
    || (title && title.center ? Math.hypot(a.center.x-title.center.x,a.center.y-title.center.y)-Math.hypot(b.center.x-title.center.x,b.center.y-title.center.y) : 0)
    || nodes.indexOf(b)-nodes.indexOf(a))[0];
  // ★ 备用入口起手会撞上「是否继续编辑」：这是上一轮中断留下的半成品。
  //   本次要发的是队列里的新内容 ⇒ 在这里点「放弃」是正确且安全的；
  //   它不能和下面「取消上传/取消发布」等同等待（那些涉及正在执行的内容）。
  const resumeTitle = own.find(n => /^是否继续编辑/.test(text(n)));
  const resumeCancel = own.find(n => usable(n) && /:id\/tvCancel$/.test(n.id) && /^(放弃|取消)$/.test(text(n)));
  if (resumeTitle && resumeCancel) {
    return { name: '未完成内容继续编辑提示', title: text(resumeTitle), button: resumeCancel, resume: true };
  }
  // ★★ 发布页自己的返回确认条（见 inspectPublishExit）：它的「保存并退出」是内容不丢的出口。
  //   放在这里是为了**不落到下面那条「未识别弹窗 / 继续观察」**——那条只会一直等，
  //   而这一屏其实有明确出路（点「保存并退出」就能把上一次残留的发布页收掉）。
  const publishExit = inspectPublishExit(own);
  if (publishExit) {
    return { name: '发布页返回确认 · ' + publishExit.name, button: publishExit.button, publishExit: true };
  }
  // 这些按钮涉及正在执行的内容，不能把“取消”当作普通弹窗关闭。
  const unsafe = own.find(n => /^(取消上传|取消发布|放弃发布|放弃编辑|保存草稿|是否继续编辑|确认支付|确认付款|退出登录)$/.test(text(n)));
  if (unsafe) return { waiting: true, name: text(unsafe) + '（等待内容操作结束，不取消上传或发布）' };
  for (const rule of RULES) {
    const title = own.find(n => rule.titles.includes(text(n))
      && /(?:^android:id\/alertTitle$|:id\/(?:tv_title|dialog_title)$)/.test(n.id));
    if (!title) continue;
    const buttons = own.filter(n => usable(n) && (rule.buttons.includes(text(n)) || explicitClose(n)));
    return buttons.length ? { name: rule.name, title: text(title), button: pick(buttons,title) }
      : { waiting: true, name: rule.name + '（等待明确关闭入口）' };
  }
  // ★ 2026-10-17：只为**看得见**的弹窗容器进入「继续观察」。树里常年挂着一个
  //   bounds 为 0 的 Dialog 壳（动态流/主页都有），旧写法会让入口一直等它，相机一下都不点。
  const shown = n => !n.box || (n.box.x2 > n.box.x1 && n.box.y2 > n.box.y1);
  const dialog = nodes.find(n => shown(n) && (/^android\.app\.Dialog$/.test(n.cls) || /(?:^|\.)Dialog$/.test(n.cls) || n.id === 'android:id/alertTitle'));
  const closes = own.filter(n => usable(n) && explicitClose(n));
  if (closes.length) return { name: '页面关闭提示', title: text(dialog || {}) || '页面关闭提示', button: pick(closes,dialog) };
  // unrecognized + node：交给调用方试一次「点弹窗外侧」，而不是干等到超时。
  return dialog ? {
    waiting: true,
    unrecognized: true,
    node: dialog,
    container: dialog,
    name: (text(dialog) || '未识别弹窗') + '（暂无明确关闭入口，继续观察）'
  } : null;
}

/**
 * 给发布步骤用的“明确弹层”识别。
 *
 * 与入口弹窗规则分开：入口只关心会挡住相机的弹窗，普通步骤需要在**不覆盖目标中心**
 * 的居中弹窗上也能识别。判据必须同时满足“独立弹层身份”和“可见”，
 * 不能把普通 RecyclerView/ViewGroup 或目标自身子节点当弹窗。
 */
function inspectModal(nodes, target, options = {}) {
  const all = Array.isArray(nodes) ? nodes : [];
  const shown = n => !!(n && n.box && n.box.x2 > n.box.x1 && n.box.y2 > n.box.y1);
  const text = n => String((n && (n.text || n.desc)) || '').trim();
  const cls = n => String((n && n.cls) || '');
  const dialogClass = n => /(?:^|\.)(?:Dialog|PopupWindow)$/.test(String((n && n.cls) || ''));
  // android:id/alertTitle 是系统对话框标题，包名可能是 android 而不是得物。
  // 它本身就是明确弹层身份，不能再用得物包名把它过滤掉。
  // 同一个 Dialog 里若只有“正在导出图片/请不要退出得物”这类正常加载文字，
  // 它不是需要清理的弹窗，延迟的入口观察会等它结束；这里不阻断目标点击。
  const dialog = all.find(n => shown(n)
    && (dialogClass(n) || n.id === 'android:id/alertTitle'));
  // 带正常加载文字的 Dialog/PopupWindow 是页面的处理中状态，不是需要关闭的弹窗。
  // 必须在选到任一 Dialog 后统一退出，不能先选到外层 Dialog 再让后面的文字分支失效。
  // 注意：普通标题页也可能紧跟着一个全屏 FrameLayout；fullScrim 不是弹窗身份。
  // 只有 Dialog/PopupWindow/alertTitle 才能直接作为“明确弹层”进入下面的分支。
  if (!options.allowLoading && hasNormalLoading(all)) return null;
  const explicitClose = n => shown(n) && n.enabled && n.center
    && (/^(?:关闭|×|✕|Close)$/i.test(text(n))
      || /:id\/(?:iv_?close|btn_?close|dialog_?close|close(?:_?button)?)$/i.test(String((n && n.id) || '')));
  if (dialog) {
    const screen = all.reduce((a, n) => {
      const b = n && n.box;
      if (!b || b.x2 <= b.x1 || b.y2 <= b.y1) return a;
      return { w: Math.max(a.w, b.x2), h: Math.max(a.h, b.y2) };
    }, { w: 0, h: 0 });
    // 真实页面里 Dialog 节点与关闭按钮常是同级（同一 Window 的两层），并不一定在
    // xml 里嵌套；require `child bounds inside dialog` would make a visible close
    // button invisible to inspectModal.  Use it when it is geometrically inside the
    // Dialog, otherwise only accept it when a full-screen scrim proves the modal owns
    // the whole window.  This keeps ordinary page close icons from becoming modal exits.
    // 全屏 scrim 必须自己带“遮罩身份”：可点击的全屏层，或 id/class 明确写着
    // scrim / dialog / popup。普通页面 root FrameLayout 也覆盖整屏，但它不是遮罩；
    // 把它收进来会让同屏的关闭图标被误认为“弹窗自己的关闭入口”。
    // 系统对话框常见的 DecorView/root 不可点，但同层可点关闭按钮证明它确实拥有
    // 整个窗口；普通页面 root 仍被排除。显式 id/class 的 scrim 也直接认。
    const fullSize = n => shown(n) && n.box.x1 <= 0 && n.box.y1 <= 0
      && n.box.x2 >= screen.w * 0.98 && n.box.y2 >= screen.h * 0.98;
    const scrimNode = all.find(n => n !== dialog && fullSize(n)
      && (n.clickable || /(?:scrim|dialog|popup)/i.test(String(n.id || '') + ' ' + String(n.cls || ''))));
    const ownsWindow = /(?:^|\.)Dialog$/.test(cls(dialog)) || dialog.id === 'android:id/alertTitle';
    // Real Android Dialog windows commonly expose their close button as a
    // sibling of the content node. The Dialog's independent window identity is
    // what proves ownership; requiring the button to be inside the content
    // bounds turns a valid close exit into "no close button" and leaves the
    // camera permanently blocked. A matching page-level close without Dialog
    // identity is still rejected.
    const close = all.find(n => explicitClose(n) && n !== dialog && !fullSize(n)
      && (!!scrimNode || ownsWindow || !dialog.box
        || (n.box.x1 >= dialog.box.x1 && n.box.y1 >= dialog.box.y1
          && n.box.x2 <= dialog.box.x2 && n.box.y2 <= dialog.box.y2)));
    const descendant = all.find(n => n !== dialog && shown(n) && text(n)
      && n.box.x1 >= dialog.box.x1 && n.box.y1 >= dialog.box.y1
      && n.box.x2 <= dialog.box.x2 && n.box.y2 <= dialog.box.y2);
    const targetInside = !!(target && target.center && dialog.box
      && dialog.box.x1 <= target.center.x && target.center.x <= dialog.box.x2
      && dialog.box.y1 <= target.center.y && target.center.y <= dialog.box.y2);
    return {
      node: dialog,
      container: dialog,
      button: close || null,
      name: text(dialog) || text(descendant || {}) || dialog.id || '页面弹窗',
      fullScreenScrim: scrimNode && scrimNode !== dialog ? scrimNode : null,
      // Android Dialog 拥有独立的模态 Window：即使内容 bounds 只占居中一块，
      // 落在内容外的触摸也会先被 Dialog Window 接收。PopupWindow 不具备这个保证。
      windowOwnsScreen: ownsWindow,
      // 居中弹窗的判断只能用于“窗口本身拥有全屏触摸”的 Dialog；
      // 侧栏 PopupWindow 即使把内容画在屏幕中部，也不能因此关掉它。
      centeredWindow: ownsWindow,
      // 页内 PopupWindow 只有真的与目标点击点几何相交时才算挡住。
      overlapsTarget: targetInside
    };
  }
  const screen = (all || []).reduce((a, n) => {
    const b = n && n.box;
    if (!b || b.x2 <= b.x1 || b.y2 <= b.y1) return a;
    return { w: Math.max(a.w, b.x2), h: Math.max(a.h, b.y2) };
  }, { w: 0, h: 0 });
  const centeredText = n => shown(n) && !!text(n)
    && Math.abs((n.box.x1 + n.box.x2) / 2 - screen.w / 2) <= Math.max(80, screen.w * 0.15)
    && (n.box.y1 + n.box.y2) / 2 >= screen.h * 0.2
    && (n.box.y1 + n.box.y2) / 2 <= screen.h * 0.8
    && (n.box.x2 - n.box.x1) <= screen.w * 0.9
    && (n.box.y2 - n.box.y1) <= screen.h * 0.9;
  const fullScrim = n => shown(n)
    && n.box.x1 <= 0 && n.box.y1 <= 0
    && n.box.x2 >= screen.w * 0.98 && n.box.y2 >= screen.h * 0.98
    && (n.clickable || /(?:scrim|dialog|popup)/i.test(String(n.id || '') + ' ' + String(n.cls || '')));
  const close = all.find(explicitClose);
  const title = all.find(n => centeredText(n) && n !== close);
  const scrim = all.find(fullScrim) || null;
  // 真机上有一类弹层没有标题文字，只有明确的全屏 scrim + 关闭按钮。
  // 这不等于“页面上任意 close 图标”：scrim 必须是可点击的全屏层，或 id/class
  // 明确写着 scrim/dialog/popup；关闭按钮还必须落在 scrim 范围内。
  if ((!title || !close) && close && scrim) {
    const inside = (inner, outer) => !!(inner && outer && inner.box && outer.box
      && inner.box.x1 >= outer.box.x1 && inner.box.y1 >= outer.box.y1
      && inner.box.x2 <= outer.box.x2 && inner.box.y2 <= outer.box.y2);
    if (inside(close, scrim)) {
      return {
        node: scrim,
        container: scrim,
        button: close,
        name: text(close) || close.id || '页面弹窗',
        fullScreenScrim: scrim
      };
    }
  }
  // 只有“居中文字 + 明确关闭按钮 / 全屏遮罩”还不够：动态流的卡片文案也可能居中。
  // 普通内容页的标题必须排在目标之后（绘制层在上）才接受；已经在正常加载时直接返回 null。
  // 没有 Dialog 类名时，不能仅凭“大容器”猜弹窗。
  // 只接受两种可复算组合：居中文字内容 + 明确关闭按钮，或居中文字内容 + 全屏遮罩。
  if (!title || !close) return null;
  // “正在导出图片 / 请不要退出得物”这类正常加载没有可点出口。
  // 它是等待态，不是需要清理的弹窗；不能把它当失败，也不能点外侧。
  if (NORMAL_LOADING.test(text(title)) || ACTIVE_PUBLISHING.test(text(title))) return null;
  // 同一片居中文字可能是页面正常内容，而不是弹窗。只有它出现在目标点击点之后
  // （绘制层在上）时才接受；入口相机没有目标时，保持原来的居中弹窗+关闭按钮判据。
  if (target && target.center) {
    const targetIndex = all.indexOf(target);
    if (targetIndex >= 0 && all.indexOf(title) <= targetIndex) return null;
  }
  if (close) {
    const closeClickable = n => {
      if (!n || !n.center) return null;
      return all.find(p => p !== n && p.clickable && p.enabled && p.center
        && p.box && p.box.x1 <= n.center.x && n.center.x <= p.box.x2
        && p.box.y1 <= n.center.y && n.center.y <= p.box.y2) || null;
    };
    const area = n => n && n.box
      ? (n.box.x2 - n.box.x1) * (n.box.y2 - n.box.y1) : Number.MAX_SAFE_INTEGER;
    const contains = (outer, inner) => !!(outer && inner && outer.box && inner.box
      && outer.box.x1 <= inner.box.x1 && outer.box.y1 <= inner.box.y1
      && outer.box.x2 >= inner.box.x2 && outer.box.y2 >= inner.box.y2);
    const candidates = all.filter(n => n !== title && n !== close && shown(n)
      && contains(n, title) && contains(n, close)
      && !/^(?:android\.widget\.FrameLayout|android\.view\.ViewGroup|androidx\.recyclerview\.widget\.RecyclerView)$/.test(cls(n)))
      .sort((a, b) => area(a) - area(b));
    // 关闭文字若自身不可点，就找中心点落在它上面的可点容器；容器可能比标题大，
    // 不能只按“同时包住标题和关闭文字”筛，否则真实弹窗会退回到不可点的文字节点。
    // 但普通全屏 FrameLayout 只能当遮罩，不能当“弹窗身份”；取证时取 title 本身。
    const container = candidates.find(n => n.clickable) || candidates[0] || title;
    const button = closeClickable(close) || close;
    // 容器是“可点关闭区域”或弹窗本体，不能拿普通页面全屏层替换 title 当 cover。
    const cover = container || title;
    const label = text(container) || text(title) || (cover && (cover.id || cover.cls)) || '页面弹窗';
    // 全屏 scrim 的职责是证明“点击会被它吞掉”，不是弹窗本体/关闭出口。
    // 关闭按钮和内容都在单独一层时，把它一并交给 blocksTarget，否则会误判成“没挡住”。
    return {
      node: cover,
      container: cover,
      button: button,
      name: label,
      fullScreenScrim: scrim && scrim !== cover ? scrim : null
    };
  }
    // 无 Dialog 类名时，绝不把“全屏普通容器”单独当作弹窗。
  // 无 Dialog/PopupWindow/alertTitle 身份时，不靠文字位置或全屏面积猜弹窗。
  // 发布页的创作分析等活动面板也可能在中部偏右；把它误关会让下游坐标整体漂移。
  return null;
}

/**
 * 弹窗自己的明确关闭按钮。
 *
 * 不能拿“页面上任意一个关闭图标”当出口：动态流、编辑页自身也常有 close 图标。
 * 这里要求按钮落在弹窗身份节点或全屏遮罩内，且不能是目标本身。
 */
function closeButtonOf(nodes, cover, target) {
  const all = Array.isArray(nodes) ? nodes : [];
  const visible = n => !!(n && n.box && n.box.x2 > n.box.x1 && n.box.y2 > n.box.y1);
  const text = n => String((n && (n.text || n.desc)) || '').trim();
  const inside = (inner, outer) => !!(inner && outer
    && inner.x1 >= outer.x1 && inner.y1 >= outer.y1
    && inner.x2 <= outer.x2 && inner.y2 <= outer.y2);
  if (!cover || !cover.box) return null;
  return all.find(n => n !== cover && n !== target && visible(n)
    && n.enabled && n.center && inside(n.box, cover.box)
    && (/^(?:关闭|×|✕|Close)$/i.test(text(n))
      || /:id\/(?:iv_?close|btn_?close|dialog_?close|close(?:_?button)?)$/i.test(String(n.id || ''))))
    || null;
}

module.exports = {
  inspect,
  inspectModal,
  closeButtonOf,
  inspectPublishExit,
  hasUploadInFlight,
  hasNormalLoading,
  loadingOver,
  visibleLoading,
  hasActivePublishing,
  publishingOver,
  NORMAL_LOADING
};
