import { APP, BASE, USER } from '../../core/manager.js';

function copyHashSheets(value){try{return BASE.copyHashSheets(value);}catch(_){return JSON.parse(JSON.stringify(value));}}
function tableEditMatches(text){const regex=/<tableEdit>(.*?)<\/tableEdit>/gs;const matches=[];let match;while((match=regex.exec(String(text??'')))!==null)matches.push(match[1]);return matches;}
function snapshotFor(chat,swipeId){return chat?.swipe_info?.[swipeId]?.extra?.memo_hash_sheets||chat?.swipe_info?.[swipeId]?.memo_hash_sheets||null;}

function restoreMemoSwipeSnapshot(chatId){
    const chat=USER?.getContext?.()?.chat?.[chatId];
    if(!chat||chat.is_user===true)return;
    const swipeId=Number(chat?.swipe_id);
    if(!Number.isInteger(swipeId)||swipeId<0)return;
    const snapshot=snapshotFor(chat,swipeId);
    if(!snapshot||typeof snapshot!=='object')return;
    try{
        chat.hash_sheets=copyHashSheets(snapshot);
        if(!chat.extra||typeof chat.extra!=='object')chat.extra={};
        chat.extra.memo_hash_sheets=copyHashSheets(snapshot);
        BASE.hashSheetsToSheets(chat.hash_sheets);
        chat.tableEditMatches=tableEditMatches(chat.mes);
        console.log(`[Memo] 已从严格Swipe快照恢复表格：message=${chatId} swipe=${swipeId}`);
    }catch(error){
        console.error('[Memo] Swipe快照恢复失败，将交给原Memo重放逻辑兜底',error);
    }
}

const event=APP.event_types.MESSAGE_SWIPED;
if(event){
    APP.eventSource.on(event,restoreMemoSwipeSnapshot);
    if(typeof APP.eventSource.makeFirst==='function')APP.eventSource.makeFirst(event,restoreMemoSwipeSnapshot);
}
console.log('[Memo] Swipe精确表格快照恢复已加载（使用swipe_info.extra）');
