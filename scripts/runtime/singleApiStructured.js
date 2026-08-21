import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';
import { executeMemoTableEdit, saveMemoSnapshot } from './safeTableExecutor.js?v=memo82';

const PREF_KEY='independent_record_api_enabled';
const STRUCTURED_SCHEMA_NAME='memo_single_api_response';
const handledMessages=new WeakMap();
let pendingStructuredRequest=null;
let armedGeneration=null;
let streamRestore=null;
let referenceRestore=null;

const MEMO_SCHEMA={name:STRUCTURED_SCHEMA_NAME,description:'Memo一次API：同一次模型响应同时返回机器表格操作和正常可见回复。',strict:true,value:{type:'object',additionalProperties:false,properties:{table_edit:{type:'string',description:'仅填写Memo表格操作代码：insertRow/updateRow/deleteRow；没有变化时填写NO_CHANGE。不要包含<tableEdit>标签、Markdown或解释。'},reply:{type:'string',description:'给用户看的完整正常回复。保持角色原有写作风格和自然顺序；不要包含Memo、tableEdit、JSON说明或机器记录。'}},required:['table_edit','reply']}};

function independentEnabled(){return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY]===true;}
function singleApiActive(){const settings=USER?.tableBaseSetting;return !independentEnabled()&&settings?.isExtensionAble!==false&&settings?.isAiReadTable!==false&&settings?.isAiWriteTable!==false&&settings?.injection_mode!=='injection_off'&&settings?.step_by_step!==true;}
function isChatReplyGeneration(type,dryRun=false){if(!singleApiActive()||dryRun)return false;const value=String(type??'').toLowerCase();return value!=='quiet'&&value!=='impersonate';}
function isAppendGeneration(type){const value=String(type??'').toLowerCase();return value==='continue'||value==='append'||value==='appendfinal';}
function currentLastAssistant(){const chat=USER?.getContext?.()?.chat;if(!Array.isArray(chat)||!chat.length)return null;const last=chat[chat.length-1];return last&&last.is_user!==true?last:null;}
function restoreReferenceOverride(){if(!referenceRestore)return;const{original,timer}=referenceRestore;referenceRestore=null;if(timer)clearTimeout(timer);if(typeof original==='function')BASE.getReferencePiece=original;}
function prepareContinueReference(type,dryRun){restoreReferenceOverride();if(dryRun||!isAppendGeneration(type))return;if(USER?.tableBaseSetting?.isExtensionAble===false||USER?.tableBaseSetting?.isAiReadTable===false)return;const current=currentLastAssistant();if(!current?.hash_sheets||typeof BASE.getReferencePiece!=='function')return;const original=BASE.getReferencePiece;BASE.getReferencePiece=()=>current;const timer=setTimeout(restoreReferenceOverride,15000);referenceRestore={original,timer};console.log('[Memo] Continue生成期间使用当前assistant的最新表格快照作为参考；请求参数组装后恢复默认引用逻辑');}
function parseStructuredPayload(raw){if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;let text=String(raw??'').trim();if(!text)return null;text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();try{return JSON.parse(text);}catch(_){const first=text.indexOf('{');const last=text.lastIndexOf('}');if(first>=0&&last>first){try{return JSON.parse(text.slice(first,last+1));}catch(_){}}}return null;}
function normalizeTableEdit(raw){let value=String(raw??'').trim();if(!value||/^NO_CHANGE$/i.test(value))return'NO_CHANGE';value=value.replace(/^\s*<tableEdit>\s*/i,'').replace(/\s*<\/tableEdit>\s*$/i,'').replace(/^\s*<!--\s*/,'').replace(/\s*-->\s*$/,'').trim();return value||'NO_CHANGE';}
function buildLegacyCompatibleMessage(reply,tableEdit){const visibleReply=String(reply??'').trim();const machineBlock=tableEdit==='NO_CHANGE'?'<tableEdit><!-- NO_CHANGE --></tableEdit>':`<tableEdit><!--\n${tableEdit}\n--></tableEdit>`;return`${visibleReply}\n\n${machineBlock}`.trim();}
function appendStructuredSegment(base,reply,tableEdit){const nextSegment=buildLegacyCompatibleMessage(reply,tableEdit);const prefix=String(base??'').trimEnd();return prefix?`${prefix}\n\n${nextSegment}`:nextSegment;}
function syncCurrentSwipe(chat){if(!Array.isArray(chat?.swipes))return;const id=Number(chat?.swipe_id);if(!Number.isInteger(id)||id<0||id>=chat.swipes.length)return;chat.swipes[id]=chat.mes;}
function consumePending(){const pending=pendingStructuredRequest;pendingStructuredRequest=null;return pending;}
function restoreStreamingSetting(){if(!streamRestore)return;const{settings,value,timer}=streamRestore;streamRestore=null;if(timer)clearTimeout(timer);try{settings.stream_openai=value;}catch(_){}}
function armGeneration(type,_options,dryRun){prepareContinueReference(type,dryRun);restoreStreamingSetting();if(!isChatReplyGeneration(type,dryRun)){armedGeneration=null;return;}pendingStructuredRequest=null;armedGeneration={type:String(type??''),startedAt:Date.now()};}
function prepareStructuredPrompt(eventData){if(!armedGeneration||!singleApiActive()||eventData?.dryRun===true)return;const settings=USER?.getContext?.()?.chatCompletionSettings;if(!settings||settings.stream_openai!==true)return;settings.stream_openai=false;const timer=setTimeout(()=>restoreStreamingSetting(),15000);streamRestore={settings,value:true,timer};console.log('[Memo][structured] 本轮结构化主回复临时关闭流式；完成参数计算后自动恢复用户设置');}
async function injectStructuredSchema(generateData){restoreReferenceOverride();if(!armedGeneration||!singleApiActive()||!generateData||typeof generateData!=='object'){restoreStreamingSetting();return;}if(generateData.json_schema&&generateData.json_schema?.name!==STRUCTURED_SCHEMA_NAME){console.warn('[Memo][structured] 检测到其他扩展JSON schema，本轮Memo不覆盖该schema，避免破坏其他结构化输出。',generateData.json_schema);armedGeneration=null;pendingStructuredRequest=null;restoreStreamingSetting();EDITOR.warning('一次API记录已跳过：本轮已有其他结构化输出规则，Memo未覆盖它。');return;}const previousAssistant=currentLastAssistant();pendingStructuredRequest={createdAt:Date.now(),generationType:armedGeneration.type,baseChat:previousAssistant,baseMes:previousAssistant?String(previousAssistant.mes??''):''};armedGeneration=null;try{generateData.json_schema=structuredClone(MEMO_SCHEMA);}catch(_){generateData.json_schema=JSON.parse(JSON.stringify(MEMO_SCHEMA));}restoreStreamingSetting();console.log('[Memo][structured] 已向本次真实角色回复注入双字段JSON schema');}
function markCurrentMessageTableEditsHandled(chat){try{const{matches}=getTableEditTag(String(chat?.mes??''));chat.tableEditMatches=Array.isArray(matches)?[...matches]:[];}catch(error){console.warn('[Memo][structured] 标记本轮tableEdit已处理失败',error);}}
function restoreBaselineForFullReply(chatId,chat){try{const numericId=Number(chatId);const previous=Number.isInteger(numericId)&&numericId>0?BASE.getLastSheetsPiece(numericId-1,1000,false)?.piece:BASE.getLastSheetsPiece(1)?.piece;if(previous?.hash_sheets){BASE.hashSheetsToSheets(previous.hash_sheets);return true;}const empty=BASE.initHashSheet?.();if(empty?.hash_sheets)BASE.hashSheetsToSheets(empty.hash_sheets);return true;}catch(error){console.warn('[Memo][structured] 恢复本轮回复基线失败，将保持当前Sheet状态',error,chat);return false;}}
function setExecutionStatus(chat,tableEdit,execution){chat.__memoStrictExecution={swipeId:Number(chat?.swipe_id??0),mes:String(chat?.mes??''),tableEdit:String(tableEdit??''),ok:execution?.ok===true,changed:execution?.changed===true,noChange:execution?.noChange===true,count:Number(execution?.count||0),error:String(execution?.error||''),at:Date.now()};}
function persistFailureBaseline(chatId,chat,pending,appendMode){try{if(!appendMode)restoreBaselineForFullReply(chatId,chat);saveMemoSnapshot(chat);console.log(`[Memo][structured] 已为失败的${appendMode?'Continue':'完整回复'}保存正确基线快照`);}catch(error){console.error('[Memo][structured] 保存失败分支基线快照失败',error);}}

async function unpackStructuredReply(chatId){
    const pending=pendingStructuredRequest;if(!pending)return;
    if(Date.now()-pending.createdAt>5*60*1000){consumePending();console.warn('[Memo][structured] 丢弃过期结构化请求标记');return;}
    const chat=USER?.getContext?.()?.chat?.[chatId];if(!chat||chat.is_user)return;if(handledMessages.get(chat)===chat.mes)return;
    const currentMes=String(chat.mes??'');let basePrefix='';let structuredRaw=currentMes;
    const appendMode=isAppendGeneration(pending.generationType)&&pending.baseChat===chat&&pending.baseMes&&currentMes.startsWith(pending.baseMes);
    if(appendMode){basePrefix=pending.baseMes;structuredRaw=currentMes.slice(pending.baseMes.length).trim();}
    const payload=parseStructuredPayload(structuredRaw);
    if(!payload||typeof payload!=='object'||!('reply'in payload)||!('table_edit'in payload)){
        consumePending();persistFailureBaseline(chatId,chat,pending,appendMode);console.warn(`[Memo][structured] ${pending.generationType||'reply'} 最终内容不是预期双字段结构：`,structuredRaw);EDITOR.warning('一次API结构化响应解析失败：本轮仍只有1次API调用，表格未自动记录。');return;
    }
    const reply=String(payload.reply??'').trim();const tableEdit=normalizeTableEdit(payload.table_edit);
    if(!reply){consumePending();persistFailureBaseline(chatId,chat,pending,appendMode);EDITOR.warning('一次API结构化响应缺少正文 reply；本轮表格暂不执行。');return;}
    consumePending();chat.mes=basePrefix?appendStructuredSegment(basePrefix,reply,tableEdit):buildLegacyCompatibleMessage(reply,tableEdit);syncCurrentSwipe(chat);handledMessages.set(chat,chat.mes);
    if(!appendMode)restoreBaselineForFullReply(chatId,chat);
    const execution=executeMemoTableEdit(tableEdit,chat);markCurrentMessageTableEditsHandled(chat);setExecutionStatus(chat,tableEdit,execution);
    if(!execution.ok){try{saveMemoSnapshot(chat);}catch(error){console.error('[Memo][structured] 失败基线快照保存也失败',error);}console.error('[Memo][structured] 本轮table_edit校验/执行失败，已阻止旧宽松执行器兜底：',execution.error,tableEdit);EDITOR.warning(`一次API记录失败：${execution.error}。正文已保留，本轮未执行错误表格操作。`);}
    try{const context=USER.getContext();if(typeof context?.updateMessageBlock==='function')context.updateMessageBlock(Number(chatId),chat);}catch(error){console.warn('[Memo][structured] 重绘正常正文失败，但不影响已完成的严格表格执行',error);}
    console.log(`[Memo][structured] 单次响应已拆包：${appendMode?'续写追加':'完整回复'}｜table_edit=${tableEdit==='NO_CHANGE'?'NO_CHANGE':execution.ok?`${execution.count}项`:'失败'}｜reply=${reply.length}字`);
}

const startedEvent=APP.event_types.GENERATION_STARTED;if(startedEvent)APP.eventSource.on(startedEvent,armGeneration);
const promptEvent=APP.event_types.CHAT_COMPLETION_PROMPT_READY;if(promptEvent){APP.eventSource.on(promptEvent,prepareStructuredPrompt);if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(promptEvent,prepareStructuredPrompt);}
const settingsEvent=APP.event_types.CHAT_COMPLETION_SETTINGS_READY;if(settingsEvent){APP.eventSource.on(settingsEvent,injectStructuredSchema);if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(settingsEvent,injectStructuredSchema);}
const renderedEvent=APP.event_types.CHARACTER_MESSAGE_RENDERED;APP.eventSource.on(renderedEvent,unpackStructuredReply);if(typeof APP.eventSource.makeFirst==='function')APP.eventSource.makeFirst(renderedEvent,unpackStructuredReply);
console.log('[Memo] 一次API结构化双通道已加载：严格执行器 + 分支基线 + Continue当前锚点 + 失败分支快照保护');
