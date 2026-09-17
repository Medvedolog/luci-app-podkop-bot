'use strict';
'require view.podkop-bot.bearhole as base';
'require ui';

return base.constructor.extend({
	startBearhole:function(){
		var st=this.status||{};
		if(!st.hwelp_installed){
			ui.addNotification(null,E('p',{},_('hwelp proxy не установлен. Сначала установите пакет hwelp-proxy для архитектуры роутера.')),'warning');
			return Promise.resolve();
		}
		return base.startBearhole.call(this);
	},

	renderBody:function(){
		var node=base.renderBody.call(this),st=this.status||{};
		if(st.hwelp_installed)return node;
		var warn=node.querySelector('.alert-message.warning');
		if(warn)warn.textContent=_('hwelp proxy не установлен. Установите пакет hwelp-proxy для архитектуры роутера; Bearhole не будет пытаться запускаться без нативного бинарника.');
		var buttons=node.querySelectorAll('button');
		for(var i=0;i<buttons.length;i++){
			if((buttons[i].textContent||'').indexOf('Запустить Bearhole')>=0){
				buttons[i].disabled=true;
				buttons[i].className='cbi-button';
				buttons[i].title=_('Сначала установите hwelp-proxy');
				buttons[i].textContent=_('hwelp proxy не установлен');
			}
		}
		return node;
	}
});
