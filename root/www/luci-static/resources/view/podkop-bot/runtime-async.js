'use strict';
'require view.podkop-bot.runtime as base';
'require rpc';
'require ui';
'require dom';

var callProbeStart = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_start', params:['section','proxy','label','restore_warp'] });
var callProbeStatus = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_status' });
var callProbeResult = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_result' });
var callEnsureMixedProxy = rpc.declare({ object:'podkop_bot', method:'ensure_mixed_proxy', params:['section'] });

function asyncProbe(section, proxy, label, restoreWarp, onTick) {
	return callProbeStart(section||'', proxy||'', label||'', restoreWarp?'true':'false').then(function(r) {
		if (!r || !r.ok) throw new Error((r && r.reason) || 'probe_start_failed');
		return new Promise(function(resolve, reject) {
			var failures=0;
			function tick() {
				callProbeStatus().then(function(st) {
					failures=0;
					if (onTick) onTick(st||{});
					if (st && st.running) { window.setTimeout(tick, 1400); return; }
					return callProbeResult().then(function(d) {
						if (d && d.running) { window.setTimeout(tick, 700); return; }
						resolve(d);
					});
				}).catch(function(e) {
					failures++;
					/* A lost poll is not a lost probe. Keep reconnecting to the worker. */
					if (failures < 20) { window.setTimeout(tick, 1800); return; }
					reject(e || new Error('probe_status_unavailable'));
				});
			}
			tick();
		});
	});
}

function showFailure(self, text) {
	self.endProgress();
	dom.content(self.body, self.renderProbe({ available:false, detail:text || _('Проверка не завершилась.') }));
}

base.runCustomProxy = function() {
	var self=this,host=(this._cp.host.value||'').trim(),port=(this._cp.port.value||'').trim(),user=(this._cp.user.value||'').trim(),pass=this._cp.pass.value||'',type=this._cp.type.value||'socks5h';
	if(!host||!/^[0-9]+$/.test(port)||parseInt(port,10)<1||parseInt(port,10)>65535){showFailure(this,_('Проверьте хост и порт.'));return;}
	var auth=user?(encodeURIComponent(user)+(pass?':'+encodeURIComponent(pass):'')+'@'):'',endpoint=type+'://'+auth+host+':'+port,label=type+'://'+(user?user+':***@':'')+host+':'+port;
	this.runBtn.disabled=true;this.beginProgress(_('Проверка ручного прокси'),_('Фоновая проверка · география + 12 сервисов + скорость'));
	return asyncProbe('',endpoint,label,false).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Проверка прокси не завершилась: ')+((e&&e.message)||'?'));}).finally(function(){self.runBtn.disabled=false;});
};

base.enableMixedProxy = function(section) {
	var self=this;
	return callEnsureMixedProxy(section).then(function(r){
		if(!(r&&(r.ok||r.already_enabled)))throw new Error((r&&r.reason)||'enable_failed');
		self.beginProgress(_('Проверка секции '+section),_('Фоновая проверка · география + 12 сервисов + скорость'));
		return asyncProbe(section,'','',false);
	}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Ошибка включения/проверки Mixed Proxy: ')+((e&&e.message)||'?'));});
};

base.nextWarpTestRoute = function() {
	var self=this,items=this.warpItems||[];this.syncSelectedTarget();if(!this.selectedWarp||items.length<2)return;
	var current=this.currentWarpEndpoint(),idx=-1;items.some(function(x,i){if(x.endpoint===current){idx=i;return true;}return false;});
	var ep=items[(idx+1+items.length)%items.length].endpoint;if(this.warpNextBtn)this.warpNextBtn.disabled=true;
	this.beginProgress(_('Проверка следующего WARP'),_('Этап 1/3 · запускаю тестовый SOCKS · ')+ep);
	return this.ensureWarpTestRoute(ep).then(function(rt){
		self.setProgress(_('Этап 2/3 · фоновая проверка сервисов и скорости'));
		return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP · ')+ep,true);
	}).then(function(d){
		self.setProgress(_('Этап 3/3 · проверяю восстановление ON-AIR WARP Rescue'));
		return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});
	}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){
		self.setProgress(_('Проверяю восстановление WARP Rescue после ошибки…'));
		return self.stopWarpTestRoute().catch(function(){}).then(function(){showFailure(self,_('Проверка WARP не завершилась: ')+((e&&e.message)||'?'));});
	}).finally(function(){if(self.warpNextBtn)self.warpNextBtn.disabled=false;});
};

base.runProbe = function() {
	var self=this;this.runBtn.disabled=true;if(this.batchBtn)this.batchBtn.disabled=true;this.syncSelectedTarget();
	if(this.selectedWarp){
		var ep=this.currentWarpEndpoint();this.beginProgress(_('Проверка ON-AIR WARP'),_('Этап 1/3 · запускаю тестовый SOCKS · ')+ep);
		return this.ensureWarpTestRoute(ep).then(function(rt){self.setProgress(_('Этап 2/3 · фоновая проверка сервисов и скорости'));return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP Rescue · ')+ep,true);}).then(function(d){self.setProgress(_('Этап 3/3 · проверяю восстановление ON-AIR WARP Rescue'));return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});}).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){return self.stopWarpTestRoute().catch(function(){}).then(function(){showFailure(self,_('Проверка WARP не завершилась: ')+((e&&e.message)||'?'));});}).finally(function(){self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
	}
	var usingProxy=!!this.selectedProxy,sec=usingProxy?'':(this.selectedSection||''),prox=usingProxy?this.selectedProxy:'',lbl=usingProxy?(this.selectedProxyLabel||''):'';
	this.beginProgress(usingProxy?_('Проверка прокси'):_('Проверка секции '+sec),_('Фоновая проверка · география + 12 сервисов + скорость'));
	return asyncProbe(sec,prox,lbl,false).then(function(d){self.endProgress();dom.content(self.body,self.renderProbe(d));}).catch(function(e){showFailure(self,_('Проверка не завершилась: ')+((e&&e.message)||'?'));}).finally(function(){self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
};

base.runAllProbes = function() {
	var self=this;if(!window.confirm(_('Полная проверка всех маршрутов может выполняться до 90 секунд при большом числе прокси и заметно нагружает роутер. Продолжить?')))return Promise.resolve();
	this.runBtn.disabled=true;if(this.batchBtn)this.batchBtn.disabled=true;
	var probeable=this.sections.filter(function(s){return s.enabled_for_runtime;}),results=[],tasks=[],total=probeable.length+(this.tierProxies||[]).length+(this.warpRouteReady?1:0),n=0,chain=Promise.resolve();
	probeable.forEach(function(s){tasks.push({type:'section',label:s.name,run:function(){return asyncProbe(s.name,'','',false);}});});
	(this.tierProxies||[]).forEach(function(p){tasks.push({type:'proxy',label:p.label,run:function(){return asyncProbe('',p.endpoint,p.label,false);}});});
	if(this.warpRouteReady)tasks.push({type:'warp',label:_('WARP Rescue · WARPSCOUT'),run:function(){var ep=self.currentWarpEndpoint();return self.ensureWarpTestRoute(ep).then(function(rt){return asyncProbe('',(rt&&rt.proxy)||'socks5h://127.0.0.1:18191',_('WARP Rescue · ')+ep,true);}).then(function(d){return self.stopWarpTestRoute().catch(function(){return null;}).then(function(){return d;});});}});
	this.beginProgress(_('Проверка всех маршрутов'),_('Подготовка · всего ')+total);
	tasks.forEach(function(t){chain=chain.then(function(){n++;self.setProgress(_('Маршрут ')+n+' / '+total+' · '+t.label+' · '+_('фоновая проверка'));return t.run().then(function(d){results.push({sec:t.label,d:d,type:t.type});}).catch(function(e){if(t.type==='warp')return self.stopWarpTestRoute().catch(function(){}).then(function(){results.push({sec:t.label,d:null,type:t.type,reason:(e&&e.message)||'warp_test_failed'});});results.push({sec:t.label,d:null,type:t.type,reason:(e&&e.message)||'rpc_error'});});});});
	return chain.then(function(){self.endProgress();dom.content(self.body,self.renderBatch(results));}).finally(function(){self.endProgress();self.runBtn.disabled=false;if(self.batchBtn)self.batchBtn.disabled=false;});
};

return base;
