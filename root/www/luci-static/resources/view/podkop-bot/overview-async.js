'use strict';
'require view.podkop-bot.overview as base';
'require rpc';
'require ui';

var callProbeStart = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_start', params:['section','proxy','label','restore_warp'] });
var callProbeStatus = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_status' });
var callProbeResult = rpc.declare({ object:'podkop_bot_probe', method:'active_probe_result' });
var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}
function runProbe(){
	return callProbeStart('','','Обзор','false').then(function(r){if(!r||!r.ok)throw new Error((r&&r.reason)||'probe_start_failed');return new Promise(function(resolve,reject){var fail=0;function tick(){callProbeStatus().then(function(st){fail=0;if(st&&st.running){window.setTimeout(tick,1400);return;}callProbeResult().then(resolve).catch(reject);}).catch(function(e){fail++;if(fail<20){window.setTimeout(tick,1800);return;}reject(e);});}tick();});});
}
base.handleOutboundProbe=function(){
	ui.showModal(_('Полный тест Outbound'),[E('p',{'class':'spinning'},_('Проверка запущена на роутере. Страницу можно кратковременно потерять — тест продолжится в фоне.'))]);
	return runProbe().then(function(d){
		if(!d||d.available===false){ui.showModal(_('Полный тест Outbound'),[E('p',{},dot('yellow',(d&&d.detail)?d.detail:_('Проверка недоступна.'))),E('div',{'class':'right'},[E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);return;}
		var svc=(d.services||[]).map(function(x){var c=x.status==='ok'?'green':((x.status==='blocked'||x.status==='timeout')?'red':'yellow'),tail=(x.ms?(' · '+x.ms+' ms'):'')+(x.geo?(' · '+x.geo):'')+(x.code&&x.code!=='000'?(' · HTTP '+x.code):'');return E('div',{'style':'margin:.2em 0;'},dot(c,(x.name||'?')+tail));}),sp=d.speed||{},spc=sp.status==='ok'?'green':'red';
		ui.showModal(_('Полный тест Outbound'),[E('p',{},[E('strong',{},_('Выход: ')),(d.geo&&d.geo.ip?d.geo.ip:'—')+(d.geo&&d.geo.country?(' · '+d.geo.country):'')]),E('div',{'style':'max-height:45vh;overflow:auto;margin:.5em 0;'},svc),E('p',{},dot(spc,_('Скорость: ')+(sp.mbps||'0')+' Mbit/s · '+(sp.status||'unknown'))),E('div',{'class':'right'},[E('button',{'class':'cbi-button','click':function(){window.location=L.url('admin/services/podkop-bot/runtime/services');}},_('Открыть проверку маршрутов')),' ',E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);
	}).catch(function(e){ui.showModal(_('Полный тест Outbound'),[E('p',{},dot('red',_('Проверка не завершилась: ')+((e&&e.message)||'?'))),E('div',{'class':'right'},[E('button',{'class':'btn','click':ui.hideModal},_('Закрыть'))])]);});
};
return base;
