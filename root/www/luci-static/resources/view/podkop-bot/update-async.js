'use strict';
'require view.podkop-bot.update as base';
'require rpc';
'require ui';
'require dom';

var callPodkopUpdate = rpc.declare({ object:'podkop_bot', method:'podkop_update_check', params:['force'] });
var callPodkopRunAsync = rpc.declare({ object:'podkop_bot_update_async', method:'start' });
var COLOURS={green:'#33a02c',yellow:'#e8a33d',grey:'#888888',red:'#cc2b2b'};
function dot(c,label){return E('span',{'style':'display:inline-flex;align-items:flex-start;gap:.4em;'},[E('span',{'style':'width:.7em;height:.7em;border-radius:50%;display:inline-block;flex:none;margin-top:.28em;background:'+(COLOURS[c]||COLOURS.grey)+';'}),E('span',{},label)]);}

base.fillPodkop=function(holder,force){
	var self=this;
	callPodkopUpdate(force).then(function(d){
		var recheck=E('button',{'class':'cbi-button','style':'display:inline-flex;align-items:center;','click':function(){dom.content(holder,E('div',{'class':'cbi-section','style':'max-width:760px;margin-top:1em;'},[E('h3',{},_('Обновление Podkop')),dot('grey',_('Проверка…'))]));self.fillPodkop(holder,'true');}},_('Проверить версию'));
		var inner;
		if(!d||!d.ok||d.available===false){
			inner=[E('h3',{'style':'margin-top:0;'},_('Обновление Podkop')),dot('grey',_('Не удалось проверить (GitHub недоступен напрямую и через прокси).')),(d&&d.releases_url)?E('div',{'style':'margin-top:.5em;'},[E('a',{'href':d.releases_url,'target':'_blank','rel':'noopener'},_('Открыть релизы'))]):E('span',{}),recheck];
		}else{
			var upd=d.update_available;
			inner=[E('h3',{'style':'margin-top:0;'},_('Обновление ')+(d.name||'Podkop')),
				E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},_('Вариант')),E('span',{'class':'pb-row-val'},d.variant||'—')]),
				E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},_('Установлено')),E('span',{'class':'pb-row-val'},d.current||'—')]),
				E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},_('В репозитории')),E('span',{'class':'pb-row-val'},[upd?dot('yellow',(d.latest||'—')+_(' — доступно')):dot('green',(d.latest||'—')+_(' — актуально'))])]),
				E('div',{'class':'pb-row pb-row--plain'},[E('span',{'class':'pb-row-label'},_('Проверено через')),E('span',{'class':'pb-row-val'},d.via==='socks'?_('прокси SOCKS'):(d.via==='direct'?_('напрямую'):'—'))]),
				E('p',{'style':'color:#888;font-size:88%;margin:.5em 0 0;'},_('Проверка сети, загрузка установщика и само обновление выполняются на роутере в фоне. Потеря страницы LuCI не прерывает процесс.')),
				(function(){
					var pkStatus=E('span',{}),pkLog=E('pre',{'class':'pb-mono','style':'display:none;max-width:760px;max-height:260px;overflow:auto;background:var(--background-color-high,var(--background-color,var(--background,rgba(30,30,30,.96))));padding:.6em;border-radius:6px;white-space:pre-wrap;font-size:80%;margin-top:.5em;'}),pkNodes={status:pkStatus,log:pkLog},name=d.name||'Podkop',cls=upd?'cbi-button cbi-button-action':'cbi-button';
					var btn=E('button',{'class':cls,'style':'display:inline-flex;align-items:center;','click':ui.createHandlerFn(self,function(){
						if(!confirm(_('Запустить обновление Podkop? Установщик будет скачан и выполнен от root. Туннель может кратко прерваться.')))return;
						btn.disabled=true;pkLog.style.display='block';dom.content(pkStatus,dot('yellow',_('Запускаю фоновую проверку и обновление…')));
						return callPodkopRunAsync().then(function(r){if(r&&r.ok){self.pollPodkopLog(pkNodes,btn);return;}var m={already_running:_('обновление уже идёт'),download_failed:_('не удалось скачать install.sh'),bad_script:_('скачанный файл не является скриптом'),repos_unreachable:_('репозитории недоступны'),low_disk:_('мало места на диске')};dom.content(pkStatus,dot('red',(m[r&&r.reason]||_('ошибка запуска'))+(r&&r.detail?(' · '+r.detail):'')));btn.disabled=false;}).catch(function(e){dom.content(pkStatus,dot('red',_('ошибка запуска: ')+((e&&e.message)||'?')));btn.disabled=false;});
					})},upd?(_('Обновить ')+name):(_('Обновить ')+name+_(' (актуально)')));if(!upd)btn.disabled=true;
					return E('div',{'style':'margin-top:.5em;'},[E('div',{'class':'pb-action-row','style':'display:flex;gap:.5em;flex-wrap:wrap;align-items:stretch;'},[E('a',{'class':'cbi-button','style':'display:inline-flex;align-items:center;','href':d.releases_url||d.repo_url,'target':'_blank','rel':'noopener'},_('Страница релизов')),recheck,btn]),pkStatus,pkLog]);
				})()
			];
		}
		dom.content(holder,E('div',{'class':'cbi-section','style':'max-width:760px;border:1px solid var(--border-color-medium,rgba(127,127,127,.2));border-radius:8px;padding:1em 1.2em;background:var(--background-color-high,var(--background-color,var(--background,rgba(40,40,40,.94))));margin-top:1em;'},inner));
	}).catch(function(){});
};

return base;
