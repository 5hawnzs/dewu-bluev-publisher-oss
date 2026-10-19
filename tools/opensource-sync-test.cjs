'use strict';
// 独立仓库验证同步边界，不修改正式源码或真实公开仓库。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
const { sync } = require('./opensource-sync.cjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bluev-oss-'));
const source = path.join(base, 'private'), target = path.join(base, 'public');
fs.mkdirSync(source);
const git = (...args) => cp.execFileSync('git', ['-C', source, ...args], { windowsHide: true, stdio: 'pipe' });
function write(file, text) { const full = path.join(source, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, text); }
function commit() { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'); }
write('package.json', JSON.stringify({ name: 'private', version: '1.0.0', build: { nsis: {} } }));
write('package-lock.json', JSON.stringify({ name: 'private', packages: { '': { name: 'private', version: '1.0.0' } } }));
write('src/main/llmdefaults.js', "module.exports={apiKey:'" + 'private-model-' + "placeholder-123456789'};");
write('src/main/clouddefaults.js', "module.exports={url:'https://" + "private-fixture.invalid'};");
write('src/main/services/example.js', 'module.exports=1;');
write('src/renderer/example.js', 'module.exports=2;');
write('internal.txt', 'private business data');
git('init', '-q'); commit();
let count = 0;
function ok(name, run) { run(); count++; console.log('PASS ' + name); }
ok('预览不写入', () => { sync({ source, target }); assert(!fs.existsSync(target)); });
ok('全量脱敏且不带私有历史', () => { sync({ source, target, apply: true }); assert(!fs.existsSync(path.join(target, '.git'))); assert(!fs.existsSync(path.join(target, 'internal.txt'))); assert(!fs.readFileSync(path.join(target, 'src/main/llmdefaults.js'), 'utf8').includes('private-model-placeholder')); });
ok('重复同步无文件变化', () => assert.equal(sync({ source, target }).changes.length, 0));
ok('Windows 换行转换不误报冲突', () => { const file = path.join(target, 'README.md'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n')); assert.equal(sync({ source, target }).changes.length, 0); });
ok('分组同步不删除界面和安全配置', () => { write('src/main/services/example.js', 'module.exports=3;'); commit(); sync({ source, target, group: 'publishing', apply: true }); assert(fs.existsSync(path.join(target, 'src/renderer/example.js'))); assert(fs.existsSync(path.join(target, 'src/main/clouddefaults.js'))); });
ok('手改冲突在任何写入前中止', () => { fs.writeFileSync(path.join(target, 'src/main/services/example.js'), 'community change'); write('src/main/services/new.js', 'module.exports=4;'); commit(); assert.throws(() => sync({ source, target, group: 'publishing', apply: true }), /手工修改/); assert(!fs.existsSync(path.join(target, 'src/main/services/new.js'))); fs.writeFileSync(path.join(target, 'src/main/services/example.js'), 'module.exports=3;'); });
ok('只删除已管理上游文件', () => { fs.unlinkSync(path.join(source, 'src/main/services/example.js')); commit(); sync({ source, target, group: 'publishing', apply: true }); assert(!fs.existsSync(path.join(target, 'src/main/services/example.js'))); assert(fs.existsSync(path.join(target, 'README.md'))); });
ok('新增疑似凭据会阻止整个应用', () => { write('src/main/services/secret.js', 'const key="' + 'sk-' + 'a'.repeat(30) + '";'); commit(); assert.throws(() => sync({ source, target, apply: true }), /公开检查失败/); assert(!fs.existsSync(path.join(target, 'src/main/services/secret.js'))); });
ok('拒绝源目标嵌套', () => assert.throws(() => sync({ source, target: path.join(source, 'nested') }), /独立目录/));
console.log('PASS ' + count + ' 项独立同步回归；临时证据目录：' + base);
