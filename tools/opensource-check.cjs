'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert');
const {inspect}=require('./opensource-sync.cjs');
const root=path.resolve(__dirname,'..'),files=new Map();
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['.git','node_modules'].includes(item.name))continue;
 const full=path.join(dir,item.name),rel=path.relative(root,full).replace(/\\/g,'/');
 if(item.isSymbolicLink())throw Error('拒绝符号链接：'+rel);
 if(item.isDirectory())walk(full);else files.set(rel,fs.readFileSync(full));
}}
walk(root);
const problems=inspect(files);assert.deepEqual(problems,[],problems.join('\n'));
const pkg=JSON.parse(files.get('package.json'));assert.equal(pkg.build.extraResources.length,0);
assert.equal(pkg.build.appId,'org.bluev.community.publisher');
for(const file of ['src/main/llmdefaults.js','src/main/clouddefaults.js'])assert(files.get(file).toString().includes('process.env.BLUEV_OSS_'));
assert(files.get('src/main/githubupdates.js').toString().includes("REPO = ''"));
let count=0;
for(const [file]of files)if(/\.(?:js|cjs|mjs)$/.test(file)){
 const r=cp.spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('语法检查失败：'+file+'\n'+(r.stderr||r.error));count++;
}
console.log('PASS 公开目录敏感信息与配置隔离检查；'+count+' 份脚本语法检查通过');
