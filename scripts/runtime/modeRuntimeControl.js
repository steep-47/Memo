import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=memo78';

const PREF_KEY='independent_record_api_enabled';
const attempted=new WeakMap();
// 按具体assistant消息对象保存待处理任务；同一消息排队期间继续变化时只保留最新版本。
const queuedJobs=new Map();
let independentRunActive=false;
let pendingRoleGeneration={generationType:'normal',baseMes:''};

function readEnabled(){return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY]===true;}
function forceNormalMode(){if(USER?.tableBaseSetting)USER.tableBaseSetting.step_by_step=false;}
function preparePromptMode(){if(USER?.tableBaseSetting)USER.tableBaseSetting.step_by_step=readEnabled();}
function tableEditMatches(text){const regex=/<tableEdit>(.*?)<\/tableEdit>/gs;const matches=[];let match;while((match=regex.exec(String(text??'')))!==null)matches.push(match[1]);return matches;}
function snapshotFor(chat,id){return chat?.swipe_info?.[id]?.extra?.memo_hash_sheets||chat?.swipe_info?.[id]?.memo_hash_sheets||chat?.extra?.memo_hash_sheets||null;}
function restoreCurrentStrictSnapshot(chatId){if(!readEnabled())return;const chat=USER?.getContext?.()?.chat?.[chatId];if(!chat||chat.is_user===true)return;const id=Number(chat?.swipe_id);const snapshot=Number.isInteger(id)&&id>=0?snapshotFor(chat,id):null;if(!snapshot)return;try{chat.hash_sheets=BASE.copyHashSheets(snapshot);if(!chat.extra||typeof chat.extra!=='object')chat.extra={};chat.extra.memo_hash_sheets=BASE.copyHashSheets(snapshot);BASE.hashSheetsToSheets(chat.hash_sheets);chat.tableEditMatches=tableEditMatches(chat.mes);console.log(`[Memo] 独立模式渲染前恢复严格Swipe快照：message=${chatId} swipe=${id}`);}catch(error){console.warn('[Memo] 独立模式恢复严格Swipe快照失败，将交给原Memo兜底',error);}}
function beforeRendered(chatId){forceNormalMode();restoreCurrentStrictSnapshot(chatId);}
function isAppendGeneration(type){const value=String(type??'').toLowerCase();return value==='continue'||value==='append'||value==='appendfinal';}
function captureGeneration(type,_params,dryRun){if(dryRun)return;const value=String(type??'normal').toLowerCase();if(value==='quiet'||value==='impersonate')return;const chat=USER?.getContext?.()?.chat;const last=Array.isArray(chat)&&chat.length?chat[chat.length-1]:null;pendingRoleGeneration={generationType:value,baseMes:isAppendGeneration(value)&&last?.is_user!==true?String(last?.mes??''):''};}
function visibleMes(chat){return String(chat?.mes??'').replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi,'').trim();}
function tokenFor(chat){return`${Number(chat?.swipe_id??0)}\u241f${visibleMes(chat)}`;}
function hasAttempted(chat,token){return attempted.get(chat)?.has(token)===true;}
function markAttempted(chat,token){let set=attempted.get(chat);if(!set){set=new Set();attempted.set(chat,set);}set.add(token);}
function currentChatId(chat){const list=USER?.getContext?.()?.chat;return Array.isArray(list)?list.indexOf(chat):-1;}
function makeJob(chatId,chat,generationInfo,{forceFull=false}={}){const visible=visibleMes(chat);return{chatId:Number(chatId),chat,generationInfo:{...(generationInfo||{})},visible,todoChats:String(chat?.mes??''),token:tokenFor(chat),forceFull:forceFull===true,createdAt:Date.now()};}
function queueLatest(job){if(!job?.chat)return;const previous=queuedJobs.get(job.chat);const next={...job,forceFull:previous?true:job.forceFull};queuedJobs.set(job.chat,next);console.log(`[Memo] 独立记录已排队：message=${job.chatId} swipe=${Number(job.chat?.swipe_id??0)}${next.forceFull?'｜完整重算':''}`);}
function drainQueue(){if(independentRunActive||!queuedJobs.size||!readEnabled())return;const first=queuedJobs.entries().next().value;if(!first)return;const[chat,job]=first;queuedJobs.delete(chat);queueMicrotask(()=>startIndependentJob(job));}
function enqueueCurrentVersion(chat,baseInfo={}){if(!chat||chat.is_user===true)return;const id=currentChatId(chat);if(id<0)return;const visible=visibleMes(chat);const token=tokenFor(chat);if(hasAttempted(chat,token)&&!queuedJobs.has(chat))return;queueLatest(makeJob(id,chat,{...baseInfo,generationType:'normal',baseMes:''},{forceFull:true}));}

function startIndependentJob(job){
    if(!job?.chat||!readEnabled()||!USER?.tableBaseSetting){drainQueue();return;}
    const chat=job.chat;
    const liveId=currentChatId(chat);
    if(liveId<0||chat.is_user===true){drainQueue();return;}
    const liveToken=tokenFor(chat);
    if(liveToken!==job.token){
        // 尚未发请求就已经变成新版本：旧任务不消费API，直接改排最新完整版本。
        queueLatest(makeJob(liveId,chat,{generationType:'normal',baseMes:''},{forceFull:true}));
        drainQueue();
        return;
    }
    if(hasAttempted(chat,job.token)){drainQueue();return;}

    markAttempted(chat,job.token);
    independentRunActive=true;
    const options={
        ...job.generationInfo,
        targetPiece:chat,
        todoChats:job.todoChats,
        expectedVisible:job.visible,
        forceFull:job.forceFull,
    };
    let task;
    try{
        USER.tableBaseSetting.step_by_step=true;
        task=TableTwoStepSummary('auto',options);
    }catch(error){
        independentRunActive=false;forceNormalMode();console.error('[Memo] 独立记录 API 启动失败:',error);EDITOR.warning(`独立记录未启动：${error?.message||error}`);drainQueue();return;
    }finally{forceNormalMode();}

    Promise.resolve(task)
        .then(result=>{
            if(result===true){
                EDITOR.success('独立填表完成！');
                console.log(`[Memo] 独立记录 API：message=${liveId} swipe=${Number(chat?.swipe_id??0)} ${options.forceFull?'完整重算':options.generationType||'normal'}完成`);
                return;
            }
            if(result==='stale'){
                // API期间正文发生了Continue/Swipe变化，旧结果已由记录核心丢弃；只排当前最新版本，不报失败。
                console.log('[Memo] 独立记录旧结果已作废：正文在API期间变化，排队重算最新版本');
                enqueueCurrentVersion(chat,options);
                return;
            }
            console.warn('[Memo] 独立记录 API：本版本未完成写入；为避免重复扣费不会自动重试同一版本');
            EDITOR.warning('独立记录未完成：本轮未成功写入。不会自动重试；可手动立即填表或重新生成。');
        })
        .catch(error=>{console.error('[Memo] 独立记录 API 执行异常:',error);EDITOR.warning(`独立记录执行异常：${error?.message||error}。不会自动重试。`);})
        .finally(()=>{independentRunActive=false;forceNormalMode();drainQueue();});
}

function triggerIndependentRecord(chatId,forcedInfo=null){
    if(!readEnabled()||!USER?.tableBaseSetting)return;
    const chat=USER?.getContext?.()?.chat?.[chatId];
    if(!chat||chat.is_user===true)return;
    const token=tokenFor(chat);
    if(hasAttempted(chat,token)&&!queuedJobs.has(chat))return;
    const generationInfo=forcedInfo||{...pendingRoleGeneration};
    const job=makeJob(chatId,chat,generationInfo,{forceFull:false});
    if(independentRunActive){
        // 同一消息已有旧版本排队时，新版本覆盖并强制整条重算；不同消息按插入顺序串行。
        queueLatest({...job,forceFull:queuedJobs.has(chat)});
        return;
    }
    startIndependentJob(job);
}

const startedEvent=APP.event_types.GENERATION_STARTED;if(startedEvent)APP.eventSource.on(startedEvent,captureGeneration);
const promptEvent=APP.event_types.CHAT_COMPLETION_PROMPT_READY;
const renderedEvent=APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(promptEvent,preparePromptMode);
APP.eventSource.on(renderedEvent,beforeRendered);
APP.eventSource.on(renderedEvent,triggerIndependentRecord);
if(typeof APP.eventSource.makeFirst==='function'){APP.eventSource.makeFirst(promptEvent,preparePromptMode);APP.eventSource.makeFirst(renderedEvent,beforeRendered);}
if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(renderedEvent,triggerIndependentRecord);
forceNormalMode();
console.log('[Memo] 独立记录 API：消息版本绑定队列 + stale丢弃 + 严格Swipe快照 + Continue增量');
