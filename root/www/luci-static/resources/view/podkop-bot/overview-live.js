'use strict';
'require view.podkop-bot.overview-state as base';
'require dom';

var FORKOP_URL='https://github.com/ushan0v/forkop';

function renderPlusMigration(data){
	if(!data||data.podkop_variant!=='plus')return;
	var cell=document.getElementById('podkop-ver-cell');
	if(!cell)return;
	var version=(data.podkop_version&&data.podkop_version!=='unknown')?data.podkop_version:'—';
	var link=E('a',{
		'href':FORKOP_URL,
		'target':'_blank',
		'rel':'noopener',
		'style':'margin-left:.45em;font-weight:600;color:#e8a33d;text-decoration:none;',
		'title':_('Podkop Plus больше не поддерживается. Продолжение проекта — Forkop.')
	},'🔔 '+_('Forkop'));
	dom.content(cell,[E('span',{},version),link]);
}

return base.constructor.extend({
	render:function(data){
		var node=base.render.call(this,data);
		if(data&&data.podkop_variant==='plus'){
			[0,1200,3500,8000].forEach(function(delay){
				window.setTimeout(function(){renderPlusMigration(data);},delay);
			});
		}
		return node;
	}
});
