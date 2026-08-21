import { APP, EDITOR, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakMap();

function independentEnabled(){return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY]===true;}
function tokenFor(chat,status){return`${Number(chat?.swipe_id??0)}\u241f${String(status?.mes??'')}\u241f${String(status?.tableEdit??'')}`;}
function wasHandled(chat,token){return handled.get(chat)?.has(token)===true;}
function markHandled(chat,token){let set=handled.get(chat);if(!set){set=new Set();handled.set(chat,set);}set.add(token);}

async function finishSingleApi(chatId){
    if(independentEnabled())return;
    const chat=USER?.getContext?.()?.chat?.[chatId];
    if(!chat||chat.is_user===true)return;
    const persistence=chat.__memoStrictPersistence;
    if(persistence&&typeof persistence.then==='function'){try{if(await persistence!==true)return;}catch(_){return;}}
    const status=chat.__memoStrictExecution;
    if(!status||status.ok!==true||status.changed!==true||status.noChange===true)return;
    if(Number(status.swipeId)!==Number(chat?.swipe_id??0))return;
    if(String(status.mes??'')!==String(chat.mes??''))return;
    const token=tokenFor(chat,status);
    if(wasHandled(chat,token))return;
    markHandled(chat,token);
    EDITOR.success('填表完成！','',2500);
}

APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED,finishSingleApi);
console.log('[Memo] 一次API绿色提示已加载：只相信本轮严格执行器真实成功结果');
