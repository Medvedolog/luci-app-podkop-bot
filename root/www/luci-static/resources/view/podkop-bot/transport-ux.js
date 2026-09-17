'use strict';
'require view.podkop-bot.transport as base';
'require ui';

/*
 * The base transport view historically auto-runs testFullChain() on render and
 * after mutations. On a slow router LuCI can re-render before that cascade has
 * finished, starting a second network probe and a second notification. The UX
 * wrapper makes the expensive probe explicitly user-driven and keeps only one
 * probe in flight across re-renders.
 */
var _manualChainProbe = null;

/* Bearhole has its own Transport sub-tab. Keep the proxy-chain page focused
 * only on Telegram/transport routing and editing semantics. */
return base.constructor.extend({
	render:function(data){
		var self=this, root=base.render.call(this,data), old=this._testAllBtn;
		/* Replace the base button so a click bypasses the auto-probe suppression
		 * below and deliberately invokes the real base implementation. */
		if(old&&old.parentNode){
			var btn=E('button',{
				'class':'cbi-button cbi-button-action',
				'click':ui.createHandlerFn(this,function(){return self.runFullChainManual();})
			},_('Проверить всю цепочку'));
			old.parentNode.replaceChild(btn,old);
			this._testAllBtn=btn;
		}
		return root;
	},

	/* Calls without an explicit user action come from base.render() and
	 * refreshState(mutated). Never turn opening/re-rendering the page into an
	 * active Telegram probe. Reuse the last session cache instead. */
	testFullChain:function(){
		if(this.applyChainCache)this.applyChainCache();
		return Promise.resolve();
	},

	runFullChainManual:function(){
		var self=this;
		if(_manualChainProbe)return _manualChainProbe;
		if(this._testAllBtn)this._testAllBtn.disabled=true;
		_manualChainProbe=Promise.resolve(base.testFullChain.call(this)).finally(function(){
			_manualChainProbe=null;
			if(self._testAllBtn)self._testAllBtn.disabled=false;
		});
		return _manualChainProbe;
	},

	bearholeCard:function(){
		return E('span',{});
	},

	bearResultFor:function(){
		return null;
	},

	addFbRow:function(){
		return E('details',{'style':'margin-top:.8em;padding-top:.7em;border-top:1px solid rgba(127,127,127,.12);'},[
			E('summary',{'style':'cursor:pointer;font-weight:600;'},_('Подсказка: редактирование и включение')),
			E('div',{'style':'color:#888;font-size:85%;margin-top:.65em;line-height:1.7;'},[
				E('div',{},_('Не все уровни цепочки редактируются вручную:')),
				E('div',{'style':'padding-left:.6em;margin-top:.25em;'},[
					E('div',{},_('• Podkop SOCKS5 (tier1): ✎ изменить порт Mixed Proxy; если он выключен — включить Mixed Proxy.')),
					E('div',{},_('• section_*: Mixed Proxy других секций обнаруживаются автоматически и доступны только для чтения.')),
					E('div',{},_('• Резервные прокси (tier2): ✎ изменить · ↑ ↓ порядок перебора · ✕ удалить.')),
					E('div',{},_('• Свой прокси (tier3): ✎ задать или изменить.')),
					E('div',{},_('• WARP Rescue: появляется автоматически, когда WARPSCOUT установлен, учётная запись готова и Rescue включён.')),
					E('div',{},_('• Прямой выход WAN (tier4): ⚙ выбрать интерфейс привязки.')),
					E('div',{},_('• Аварийные IP Telegram (tier5): не редактируются.'))
				]),
				E('div',{'style':'margin-top:.55em;'},_('Для резервного прокси тип, хост, порт, логин, пароль и мнемоника вводятся отдельными полями.'))
			])
		]);
	}
});
