'use strict';
// 白名单导出，不复制原 Git 历史；同步前检查密钥和社区侧手工修改。
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'opensource/sync-policy.json'), 'utf8'));
const rawHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Git 在 Windows 检出时可能转换换行；摘要忽略文本换行差异，二进制保持逐字节。
const hash = bytes => rawHash(bytes.includes(0) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')));
const git = (source, args) => cp.execFileSync('git', ['-C', source, ...args], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const normalize = file => file.replace(/\\/g, '/');
function groupOf(file) {
  if (file.startsWith('src/renderer/') || file.startsWith('build/')) return 'ui';
  if (file.startsWith('tools/')) return 'tests';
  if (file.startsWith('docs/')) return 'backend';
  if (policy.publishingFiles.includes(file) || policy.publishingPrefixes.some(p => file.startsWith(p))) return 'publishing';
  return 'foundation';
}
function inspect(files, denied = []) {
  const problems = [];
  for (const [file, bytes] of files) {
    if (policy.sensitiveFilesExcluded.includes(path.posix.basename(file))) problems.push(file + '：禁止公开的本机配置');
    if (/(?:^|\/)(?:\.git|node_modules|vendor|dist|distribution|failures|dumps)(?:\/|$)/.test(file)
      || /\.(?:exe|dll|apk|asar|xlsx|log|part\d+)$/i.test(file)) problems.push(file + '：禁止公开的文件类型或目录');
    if (bytes.includes(0)) { if (!['build/icon.ico', 'build/icon.png'].includes(file)) problems.push(file + '：未审查的二进制'); continue; }
    const text = bytes.toString('utf8');
    const rules = [/\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/,
      /\bsk-[A-Za-z0-9_-]{20,}/, /\b(?:AKIA|ASIA)[A-Z0-9]{16}/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /https:\/\/[^\s/]+:[^\s/]+@/];
    if (rules.some(re => re.test(text)) || denied.some(value => value.length > 12 && text.includes(value))) problems.push(file + '：疑似凭据或原项目服务标识（值不输出）');
    for (const match of text.matchAll(/\beyJ[\w-]+\.([\w-]+)\.[\w-]+/g)) {
      try { if (JSON.parse(Buffer.from(match[1], 'base64url')).role === 'service_role') problems.push(file + '：禁止服务端特权密钥'); } catch {}
    }
  }
  return [...new Set(problems)];
}
function safePath(target, file) {
  if (!file || path.isAbsolute(file) || normalize(file).split('/').some(p => p === '..' || p === '.git') || file.includes('\0')) throw Error('路径不安全');
  const full = path.resolve(target, file), rel = path.relative(target, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('路径越界');
  let dir = target;
  for (const part of rel.split(path.sep)) { dir = path.join(dir, part); if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('不允许通过符号链接写入：' + file); }
  return full;
}
function sanitize(file, raw) {
  if (raw.includes(0)) return raw;
  let text = raw.toString('utf8');
  if (file === 'src/main/index.js') {
    if (!text.includes("app.setAppUserModelId('com.bluev.publisher')")) throw Error('应用标识发生变化，请先审查');
    text = text.replace("app.setAppUserModelId('com.bluev.publisher')", "app.setAppUserModelId('org.bluev.community.publisher')");
  }
  if (file === 'tools/cloudauth-test.js') {
    text = text.replace("'use strict';", "'use strict';\n// 测试专用占位服务，网络请求由本文件桩接管。\nprocess.env.BLUEV_OSS_SUPABASE_URL = 'https://auth-fixture.invalid';\nprocess.env.BLUEV_OSS_SUPABASE_ANON_KEY = 'sb_publishable_test_fixture';");
  }
  if (file === 'src/main/jobs.js' || file === 'src/renderer/app.js') {
    const tester = /const FALLBACK_TEST_USER = '[^']*';/;
    if (!tester.test(text)) throw Error('账号专用开关发生变化，请先审查：' + file);
    text = text.replace(tester, "const FALLBACK_TEST_USER = '';");
  }
  if (file === 'src/main/store.js') {
    if (!/cloud:\s*\{\s*enabled: true/.test(text)) throw Error('云同步默认值发生变化，请先审查');
    text = text.replace(/(cloud:\s*\{\s*enabled:) true/, '$1 false');
  }
  return Buffer.from(text);
}
function packageFor(source) {
  const pkg = JSON.parse(git(source, ['show', 'HEAD:package.json']));
  pkg.name = 'dewu-bluev-publisher-oss'; pkg.private = true;
  pkg.description = 'Windows desktop publishing workflow community edition';
  pkg.author = 'BlueV community contributors'; pkg.license = 'MIT';
  pkg.scripts = { start: 'electron .', dev: 'electron . --dev', check: 'node tools/opensource-check.cjs',
    test: 'node tools/securitytest.js && node tools/cloudauth-test.js && node tools/sqlauth-securitytest.js && node tools/opensource-sync-test.cjs', 'dist:win': 'electron-builder --win --x64 --publish never' };
  pkg.build.extraResources = []; pkg.build.appId = 'org.bluev.community.publisher';
  pkg.build.productName = 'BlueV Community Publisher'; pkg.build.nsis.shortcutName = 'BlueV Community Publisher';
  delete pkg.build.publish;
  return Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
}
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw Error('模板中不允许符号链接');
    return item.isDirectory() ? walk(file, base) : [[normalize(path.relative(base, file)), fs.readFileSync(file)]];
  });
}
function sync({ source, target, group = 'all', apply = false }) {
  source = path.resolve(source); target = path.resolve(target);
  for (let dir = target; ; dir = path.dirname(dir)) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw Error('目标路径不允许符号链接');
    if (dir === path.dirname(dir)) break;
  }
  if (!policy.groups.includes(group)) throw Error('未知同步分组：' + group);
  if (source === target || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw Error('源仓库与目标必须为独立目录');
  const tree = git(source, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).toString('utf8').split('\0').filter(Boolean);
  const files = new Map();
  for (const file of tree) {
    const allowed = policy.sourcePrefixes.some(p => file.startsWith(p)) || policy.sourceFiles.includes(file);
    if (!allowed || policy.protected.includes(file) || (group !== 'all' && groupOf(file) !== group)) continue;
    files.set(file, sanitize(file, git(source, ['show', 'HEAD:' + file])));
  }
  const upstreamFiles = new Set(files.keys());
  if (group === 'all') {
    for (const [file, bytes] of walk(path.join(root, 'opensource/overrides'))) files.set(file, bytes);
    files.set('package.json', packageFor(source));
    const lock = JSON.parse(git(source, ['show', 'HEAD:package-lock.json']));
    const pkg = JSON.parse(files.get('package.json')); lock.name = pkg.name;
    Object.assign(lock.packages[''], { name: pkg.name, version: pkg.version, license: pkg.license });
    files.set('package-lock.json', Buffer.from(JSON.stringify(lock, null, 2) + '\n'));
    for (const file of ['tools/opensource-sync.cjs', 'tools/opensource-check.cjs', 'tools/opensource-sync-test.cjs', 'opensource/sync-policy.json']) files.set(file, fs.readFileSync(path.join(root, file)));
    for (const [file, bytes] of walk(path.join(root, 'opensource/overrides'))) files.set('opensource/overrides/' + file, bytes);
  }
  const denied = [];
  for (const file of ['src/main/llmdefaults.js', 'src/main/clouddefaults.js']) {
    const text = git(source, ['show', 'HEAD:' + file]).toString();
    for (const m of text.matchAll(/(?:apiKey|anonKey|url):\s*['"]([^'"]+)['"]/g)) denied.push(m[1]);
  }
  const manifestFile = safePath(target, '.opensource-sync.json');
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { files: {} };
  const next = { ...previous.files }, changes = [], conflicts = [];
  const revision = git(source, ['rev-parse', 'HEAD']).toString().trim();
  for (const [file, bytes] of files) {
    const full = safePath(target, file), exists = fs.existsSync(full), actual = exists ? hash(fs.readFileSync(full)) : null;
    const wanted = hash(bytes), old = previous.files[file];
    if (actual !== wanted) {
      if (exists && (!old || (actual !== old.sha256 && rawHash(fs.readFileSync(full)) !== old.sha256))) conflicts.push(file);
      changes.push({ action: exists ? 'update' : 'add', file });
    }
    next[file] = { sha256: wanted, sourceRevision: revision, group: groupOf(file), origin: upstreamFiles.has(file) ? 'upstream' : 'overlay' };
  }
  for (const [file, old] of Object.entries(previous.files)) {
    if (group !== 'all' && old.origin !== 'upstream') continue;
    if (files.has(file) || (group !== 'all' && old.group !== group)) continue;
    const full = safePath(target, file);
    if (!fs.existsSync(full)) { delete next[file]; continue; }
    const bytes = fs.readFileSync(full);
    if (hash(bytes) !== old.sha256 && rawHash(bytes) !== old.sha256) conflicts.push(file);
    changes.push({ action: 'delete', file }); delete next[file];
  }
  // 应用前检查整个现有公开目录，而不只检查本次选择的代码。
  const publicFiles = new Map(files);
  if (fs.existsSync(target)) {
    const scan = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(item.name)) continue;
      const full = path.join(dir, item.name), rel = normalize(path.relative(target, full));
      if (item.isSymbolicLink()) throw Error('目标目录含符号链接：' + rel);
      if (item.isDirectory()) scan(full);
      else if (!publicFiles.has(rel) && !changes.some(c => c.file === rel && c.action === 'delete')) publicFiles.set(rel, fs.readFileSync(full));
    } }; scan(target);
  }
  const problems = inspect(publicFiles, denied);
  if (problems.length) throw Error('公开检查失败：\n' + problems.join('\n'));
  if (conflicts.length) throw Error('开源侧文件有手工修改，已停止，未覆盖：\n' + conflicts.join('\n'));
  if (apply) {
    fs.mkdirSync(target, { recursive: true });
    for (const c of changes) {
      const full = safePath(target, c.file);
      if (c.action === 'delete') fs.unlinkSync(full);
      else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, files.get(c.file)); }
    }
    fs.writeFileSync(manifestFile, JSON.stringify({ schema: 1, files: next }, null, 2) + '\n');
  }
  return { mode: apply ? 'applied' : 'preview', group, revision, changes };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), take = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
    if (!take('--source') || !take('--target')) throw Error('用法：node tools/opensource-sync.cjs --source 私有目录 --target 开源目录 [--group publishing|ui|foundation|tests|backend|all] [--apply]');
    console.log(JSON.stringify(sync({ source: take('--source'), target: take('--target'), group: take('--group') || 'all', apply: args.includes('--apply') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { sync, inspect, groupOf };
