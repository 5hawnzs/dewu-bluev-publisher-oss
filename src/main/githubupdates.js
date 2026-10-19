'use strict';
// 社区版不下载原项目的安装包，也不会自动退出或安装更新。
const { app } = require('electron');
const BUILD = 0, REPO = '';
const status = () => ({ ok: true, status: 'disabled', current: app.getVersion(), build: BUILD,
  percent: 0, message: '社区源码版请从本仓库获取更新' });
const unavailable = async () => ({ ...status(), ok: false, error: '社区源码版未配置安装包更新服务' });
function validate() { throw Error('社区源码版未配置安装包更新服务'); }
module.exports = { status, check: async () => status(), download: unavailable, install: unavailable,
  start() {}, validate, BUILD, REPO };
