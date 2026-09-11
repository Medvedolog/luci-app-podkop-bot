'use strict';
'require view';
'require rpc';
'require dom';

var callWarpStatus = rpc.declare({ object:'podkop_bot_warpscout', method:'status', params:['force'] });
var callWarpShortlist = rpc.declare({ object:'podkop_bot_warpscout', method:'shortlist' });
var callWarpRtStatus = rpc.declare({ object:'podkop_bot_warpscout_runtime', method:'status' });

var COLOURS = { green:'#33a02c', yellow:'#e8a33d', grey:'#888888', red:'#cc2b2b' };
function dot(c, label) {
	return E('span', { 'style':'display:inline-flex;align-items:flex-start;gap:.4em;' }, [
		E('span', { 'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';' }),
		E('span', {}, label)
	]);
}
function row(label, valNode) {
	return E('div', { 'class':'pb-row pb-row--plain' }, [
		E('span', { 'class':'pb-row-label' }, label),
		E('span', { 'class':'pb-row-val' }, [ valNode ])
	]);
}
function pbInjectCss() {
	if (document.getElementById('pb-css')) return;
	document.querySelector('head').appendChild(E('link', {
		'id':'pb-css', 'rel':'stylesheet', 'type':'text/css',
		'href': L.resource('css/podkop-bot/podkop-bot.css')
	}));
}

return view.extend({
	load: function() {
		pbInjectCss();
		return Promise.all([
			callWarpStatus('').catch(function(){ return null; }),
			callWarpShortlist().catch(function(){ return null; }),
			callWarpRtStatus().catch(function(){ return null; })
		]);
	},

	render: function(data) {
		var st=data[0], sl=data[1], rt=data[2];
		if (!st || !st.installed) {
			return E('div', {}, [
				E('h2', {}, _('Runtime — WARP Rescue')),
				E('div', { 'class':'cbi-section pb-card', 'style':'max-width:820px;' }, [
					dot('grey', _('WARPSCOUT не установлен')),
					E('div', { 'style':'margin-top:.7em;' }, [ E('a', { 'class':'cbi-button', 'href':L.url('admin/services/podkop-bot/update') }, _('Открыть Обновление')) ])
				])
			]);
		}
		var cfg=st.config||{}, active=cfg.active_endpoint||'—', item=null;
		(sl&&sl.items||[]).some(function(x){ if(x.endpoint===active){item=x;return true;}return false; });
		var tg=rt&&rt.telegram||{}, tgNode=dot('grey',_('ещё не проверялся'));
		if(tg.status==='OK') tgNode=dot('green',_('OK')+(tg.http?(' · HTTP '+tg.http):''));
		else if(tg.status==='RATE_LIMITED') tgNode=dot('yellow',_('Telegram доступен · rate limited (429)'));
		else if(tg.status==='AUTH_ERROR') tgNode=dot('yellow',_('Telegram доступен · auth error (401)'));
		else if(tg.status==='API_DENIED') tgNode=dot('yellow',_('Telegram доступен · API denied (403)'));
		else if(tg.status==='OTHER_API_RESPONSE') tgNode=dot('yellow',_('Telegram отвечает · HTTP ')+(tg.http||'?'));
		else if(tg.status==='NETWORK_FAIL') tgNode=dot('red',_('NETWORK_FAIL'));
		var checked=item&&item.checked_at?this.ago(parseInt(item.checked_at,10)):'—';
		var tgChecked=tg.checked_at?this.ago(parseInt(tg.checked_at,10)):'—';
		return E('div', {}, [
			E('h2', {}, _('Runtime — WARP Rescue')),
			E('p', { 'class':'pb-muted' }, _('Scout snapshot, живой test SOCKS и последняя проверка Telegram показаны отдельно. Это наблюдение, не управление WARPSCOUT.')),
			E('div', { 'class':'cbi-section pb-card', 'style':'max-width:820px;' }, [
				E('h3', { 'style':'margin-top:0;' }, _('WARPSCOUT / WARP Rescue')),
				row(_('Active endpoint'), E('span', {}, active)),
				row(_('Protocol'), E('span', {}, String(cfg.protocol||'—').toUpperCase())),
				row(_('NODE'), E('span', {}, item&&item.node||'—')),
				row(_('NODE LOCATION'), E('span', {}, item&&item.node_location||'—')),
				row(_('SEEN AS'), E('span', {}, item&&item.seen_as||'—')),
				row(_('Tunnel ping / loss'), E('span', {}, (item&&item.tunnel_ping||'—')+' / '+(item&&item.loss||'—'))),
				row(_('Scout data age'), E('span', {}, checked)),
				row(_('SOCKS process'), rt&&rt.running ? dot('green',_('running')+(rt.pid?(' · PID '+rt.pid):'')) : dot('grey',rt&&rt.state||_('stopped'))),
				row(_('Local SOCKS'), E('span', {}, rt&&rt.proxy||('socks5h://127.0.0.1:'+(cfg.socks_port||18191)))),
				row(_('Telegram API'), tgNode),
				row(_('Telegram test age'), E('span', {}, tgChecked)),
				E('div', { 'style':'margin-top:.7em;' }, [ E('a', { 'class':'cbi-button', 'href':L.url('admin/services/podkop-bot/transport/warpscout') }, _('Открыть настройки WARP Rescue')) ])
			])
		]);
	},

	ago: function(ts) {
		var s=Math.floor(Date.now()/1000)-ts;
		if(s<60) return _('только что');
		if(s<3600) return Math.floor(s/60)+_(' мин назад');
		if(s<86400) return Math.floor(s/3600)+_(' ч назад');
		return Math.floor(s/86400)+_(' дн назад');
	},

	handleSave:null, handleSaveApply:null, handleReset:null
});
