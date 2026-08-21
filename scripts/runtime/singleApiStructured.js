import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag } from '../../index.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js?v=memo91';

const PREF_KEY='independent_record_api_enabled';
const STRUCTURED_SCHEMA_NAME='memo_single_api_response';
const COMPAT_PROMPT_MARKER='[Memo JSON object compatibility instruction]';
const handledMessages=new WeakMap();
let pendingStructuredRequest=null;
let armedGeneration=null;
let streamRestore=null;
let referenceRestore=null;

const MEMO_SCHEMA={name:STRUCTURED_SCHEMA_NAME,description:'Memo一次API：同一次模型响应同时返回机器表格操作和正常可见回复。',strict:true,value:{type:'object',additionalProperties:false,properties:{table_edit:{type:'string',description:'这不是SQL。仅允许Memo函数调用，唯一合法函数及完整语法为：insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。没有变化时填写NO_CHANGE。严禁使用INSERT、INTO、VALUES、UPDATE、DELETE、SQL等关键字或任何SQL语法。updateRow/deleteRow的rowIndex必须是当前表格第一列真实显示的现有数字；空表严禁updateRow/deleteRow，首次记录只能insertRow。不要包含<tableEdit>标签、Markdown或解释。'},reply:{type:'string',description:'给用户看的完整正常回复。保持角色原有写作风格和自然顺序；不要包含Memo、tableEdit、JSON说明或机器记录。'}},required:['table_edit','reply']}};

function independentEnabled(){return USER?.getSettings?.()?.muyoo_dataTable?.[PREF_KEY]===true;}
function singleApiActive(){const settings=USER?.tableBaseSetting;return !independentEnabled()&&settings?.isExtensionAble!==false&&settings?.isAiReadTable!==false&&settings?.isAiWriteTable!==false&&settings?.injection_mode!=='injection_off'&&settings?.step_by_step!==true;}
function isChatReplyGeneration(type,dryRun=false){if(!singleApiActive()||dryRun)return false;const value=String(type??'').toLowerCase();return value!=='quiet'&&value!=='impersonate';}
function isAppendGeneration(type){const value=String(type??'').toLowerCase();return value==='continue'||value==='append'||value==='appendfinal';}
function currentLastAssistant(){const chat=USER?.getContext?.()?.chat;if(!Array.isArray(chat)||!chat.length)return null;const last=chat[chat.length-1];return last&&last.is_user!==true?last:null;}
function restoreReferenceOverride(){if(!referenceRestore)return;const{original,timer}=referenceRestore;referenceRestore=null;if(timer)clearTimeout(timer);if(typeof original==='function')BASE.getReferencePiece=original;}
function prepareContinueReference(type,dryRun){restoreReferenceOverride();if(dryRun||!isAppendGeneration(type))return;if(USER?.tableBaseSetting?.isExtensionAble===false||USER?.tableBaseSetting?.isAiReadTable===false)return;const current=currentLastAssistant();if(!current?.hash_sheets||typeof BASE.getReferencePiece!=='function')return;const original=BASE.getReferencePiece;BASE.getReferencePiece=()=>current;const timer=setTimeout(restoreReferenceOverride,15000);referenceRestore={original,timer};console.log('[Memo] Continue生成期间使用当前assistant的最新表格快照作为参考；请求参数组装后恢复默认引用逻辑');}
function parseStructuredPayload(raw){if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;let text=String(raw??'').trim();if(!text)return null;text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();try{return JSON.parse(text);}catch(_){const first=text.indexOf('{');const last=text.lastIndexOf('}');if(first>=0&&last>first){try{return JSON.parse(text.slice(first,last+1));}catch(_){}}}return null;}
function parseTaggedPayload(raw){const text=String(raw??'').trim();if(!text)return null;const matches=[...text.matchAll(/<tableEdit>\s*<!--([\s\S]*?)-->\s*<\/tableEdit>/gi)];if(matches.length!==1)return null;const reply=text.replace(matches[0][0],'').trim();if(!reply)return null;return{reply,table_edit:String(matches[0][1]??'').trim()||'NO_CHANGE'};}
function normalizeTableEdit(raw){let value=String(raw??'').trim();if(!value||/^NO_CHANGE$/i.test(value))return'NO_CHANGE';value=value.replace(/^\s*<tableEdit>\s*/i,'').replace(/\s*<\/tableEdit>\s*$/i,'').replace(/^\s*<!--\s*/,'').replace(/\s*-->\s*$/,'').trim();return value||'NO_CHANGE';}
function buildLegacyCompatibleMessage(reply,tableEdit){const visibleReply=String(reply??'').trim();const machineBlock=tableEdit==='NO_CHANGE'?'<tableEdit><!-- NO_CHANGE --></tableEdit>':`<tableEdit><!--\n${tableEdit}\n--></tableEdit>`;return`${visibleReply}\n\n${machineBlock}`.trim();}
function appendStructuredSegment(base,reply,tableEdit){const nextSegment=buildLegacyCompatibleMessage(reply,tableEdit);const prefix=String(base??'').trimEnd();return prefix?`${prefix}\n\n${nextSegment}`:nextSegment;}
function syncCurrentSwipe(chat){if(!Array.isArray(chat?.swipes))return;const id=Number(chat?.swipe_id);if(!Number.isInteger(id)||id<0||id>=chat.swipes.length)return;chat.swipes[id]=chat.mes;}
function consumePending(){const pending=pendingStructuredRequest;pendingStructuredRequest=null;return pending;}
function restoreStreamingSetting(){if(!streamRestore)return;const{settings,value,timer}=streamRestore;streamRestore=null;if(timer)clearTimeout(timer);try{settings.stream_openai=value;}catch(_){}}
function armGeneration(type,_options,dryRun){prepareContinueReference(type,dryRun);restoreStreamingSetting();if(!isChatReplyGeneration(type,dryRun)){armedGeneration=null;return;}pendingStructuredRequest=null;armedGeneration={type:String(type??''),startedAt:Date.now()};}
function prepareStructuredPrompt(eventData){if(!armedGeneration||!singleApiActive()||eventData?.dryRun===true)return;const settings=USER?.getContext?.()?.chatCompletionSettings;if(!settings||settings.stream_openai!==true)return;settings.stream_openai=false;const timer=setTimeout(()=>restoreStreamingSetting(),15000);streamRestore={settings,value:true,timer};console.log('[Memo][structured] 本轮结构化主回复临时关闭流式；完成参数计算后自动恢复用户设置');}
function isCustomOpenAIEndpoint(generateData){return String(generateData?.chat_completion_source??'').toLowerCase()==='custom'||Boolean(generateData?.custom_url);}
function appendCompatibilityInstruction(generateData){
    if(!Array.isArray(generateData?.messages))return false;
    if(generateData.messages.some(message=>String(message?.content??'').includes(COMPAT_PROMPT_MARKER)))return true;
    generateData.messages.push({role:'user',content:`${COMPAT_PROMPT_MARKER}\n最终content必须先正常输出给用户看的完整回复，并在全部正文结束后追加且只追加一个隐藏机器块：<tableEdit><!-- 操作 --></tableEdit>。标签后不得再输出任何字符。没有需要记录的变化时，机器块必须准确写为<tableEdit><!-- NO_CHANGE --></tableEdit>。不要输出JSON，不要解释本协议。\n机器块不是SQL。唯一合法函数及完整语法只有：insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。严禁使用INSERT、INTO、VALUES、UPDATE、DELETE、SQL等关键字或任何SQL语法；不要把非法操作猜测或改写为合法函数。\n生成机器块前必须重新核对当前表格：数据第一列明确显示的数字才是可用于updateRow/deleteRow的rowIndex；凡显示“（此表格当前为空）”的表都没有可更新行，严禁updateRow/deleteRow，首次记录只能insertRow(tableIndex,data)。禁止把tableIndex、列号或预计新增后的行号当成rowIndex。`});
    return true;
}
async function injectStructuredSchema(generateData){restoreReferenceOverride();if(!armedGeneration||!singleApiActive()||!generateData||typeof generateData!=='object'){restoreStreamingSetting();return;}if(generateData.json_schema&&generateData.json_schema?.name!==STRUCTURED_SCHEMA_NAME){console.warn('[Memo][structured] 检测到其他扩展JSON schema，本轮Memo不覆盖该schema，避免破坏其他结构化输出。',generateData.json_schema);armedGeneration=null;pendingStructuredRequest=null;restoreStreamingSetting();EDITOR.warning('一次API记录已跳过：本轮已有其他结构化输出规则，Memo未覆盖它。');return;}const customEndpoint=isCustomOpenAIEndpoint(generateData);const context=USER?.getContext?.();const previousAssistant=currentLastAssistant();pendingStructuredRequest={createdAt:Date.now(),sessionChat:context?.chat,generationType:armedGeneration.type,responseMode:customEndpoint?'tagged':'json',baseChat:previousAssistant,baseMes:previousAssistant?String(previousAssistant.mes??''):''};armedGeneration=null;if(customEndpoint){delete generateData.json_schema;const compatAdded=appendCompatibilityInstruction(generateData);restoreStreamingSetting();console.log(`[Memo][structured] 自定义OpenAI端点使用单次正文+tableEdit协议｜tail=${compatAdded?'已注入':'缺失'}`);return;}try{generateData.json_schema=structuredClone(MEMO_SCHEMA);}catch(_){generateData.json_schema=JSON.parse(JSON.stringify(MEMO_SCHEMA));}restoreStreamingSetting();console.log('[Memo][structured] 原生端点已注入双字段JSON schema');}
function markCurrentMessageTableEditsHandled(chat){try{const{matches}=getTableEditTag(String(chat?.mes??''));chat.tableEditMatches=Array.isArray(matches)?[...matches]:[];}catch(error){console.warn('[Memo][structured] 标记本轮tableEdit已处理失败',error);}}
function restoreBaselineForFullReply(chatId,chat){try{const numericId=Number(chatId);const previous=Number.isInteger(numericId)&&numericId>0?BASE.getLastSheetsPiece(numericId-1,1000,false)?.piece:BASE.getLastSheetsPiece(1)?.piece;const snapshot=previous?.hash_sheets||BASE.initHashSheet?.()?.hash_sheets;const result=restoreMemoSnapshot(snapshot);if(result.ok)return true;console.warn('[Memo][structured] 恢复本轮回复基线失败；已停止写表并回滚恢复动作',result.error,chat);return false;}catch(error){console.warn('[Memo][structured] 恢复本轮回复基线异常；已停止写表',error,chat);return false;}}
function setRuntimeField(target,key,value){Object.defineProperty(target,key,{value,writable:true,configurable:true,enumerable:false});}
function setExecutionStatus(chat,tableEdit,execution){setRuntimeField(chat,'__memoStrictExecution',{swipeId:Number(chat?.swipe_id??0),mes:String(chat?.mes??''),tableEdit:String(tableEdit??''),ok:execution?.ok===true,changed:execution?.changed===true,noChange:execution?.noChange===true,count:Number(execution?.count||0),error:String(execution?.error||''),at:Date.now()});}
async function persistChat(label){try{await USER.saveChat();return true;}catch(error){console.error(`[Memo][structured] ${label}持久化失败`,error);EDITOR.warning(`${label}已在当前页面完成，但聊天保存失败；请勿刷新并立即重试保存。`);return false;}}
async function persistFailureBaseline(chatId,chat,pending,appendMode){try{if(!appendMode&&!restoreBaselineForFullReply(chatId,chat)){console.error('[Memo][structured] 无法恢复失败回复的明确基线，拒绝把当前残留Sheet绑定到该消息');return false;}saveMemoSnapshot(chat);const saved=await persistChat('一次API失败分支基线');if(saved)console.log(`[Memo][structured] 已为失败的${appendMode?'Continue':'完整回复'}保存正确基线快照`);return saved;}catch(error){console.error('[Memo][structured] 保存失败分支基线快照失败',error);return false;}}

async function unpackStructuredReply(chatId){
    const pending=pendingStructuredRequest;if(!pending)return;
    if(Date.now()-pending.createdAt>5*60*1000){consumePending();console.warn('[Memo][structured] 丢弃过期结构化请求标记');return;}
    if(pending.sessionChat&&USER?.getContext?.()?.chat!==pending.sessionChat){consumePending();console.warn('[Memo][structured] 生成期间已切换聊天，丢弃旧聊天的一次API pending；不解析、不恢复、不保存');return;}
    const chat=USER?.getContext?.()?.chat?.[chatId];if(!chat||chat.is_user)return;if(handledMessages.get(chat)===chat.mes)return;
    const currentMes=String(chat.mes??'');let basePrefix='';let structuredRaw=currentMes;
    const appendMode=isAppendGeneration(pending.generationType)&&pending.baseChat===chat&&pending.baseMes&&currentMes.startsWith(pending.baseMes);
    if(appendMode){basePrefix=pending.baseMes;structuredRaw=currentMes.slice(pending.baseMes.length).trim();}
    const payload=parseStructuredPayload(structuredRaw)||parseTaggedPayload(structuredRaw);
    if(!payload||typeof payload!=='object'||!('reply'in payload)||!('table_edit'in payload)){
        consumePending();await persistFailureBaseline(chatId,chat,pending,appendMode);console.warn(`[Memo][structured] ${pending.generationType||'reply'} 最终内容不是预期双字段结构：`,structuredRaw);EDITOR.warning('一次API结构化响应解析失败：本轮仍只有1次API调用，表格未自动记录。');return;
    }
    const reply=String(payload.reply??'').trim();const tableEdit=normalizeTableEdit(payload.table_edit);
    if(!reply){consumePending();await persistFailureBaseline(chatId,chat,pending,appendMode);EDITOR.warning('一次API结构化响应缺少正文 reply；本轮表格暂不执行。');return;}
    consumePending();chat.mes=basePrefix?appendStructuredSegment(basePrefix,reply,tableEdit):buildLegacyCompatibleMessage(reply,tableEdit);syncCurrentSwipe(chat);handledMessages.set(chat,chat.mes);
    const baselineReady=appendMode||restoreBaselineForFullReply(chatId,chat);
    const execution=baselineReady?executeMemoTableEdit(tableEdit,chat):{ok:false,changed:false,noChange:false,count:0,error:'无法恢复本轮完整回复之前的明确表格基线'};markCurrentMessageTableEditsHandled(chat);setExecutionStatus(chat,tableEdit,execution);
    if(!execution.ok){if(baselineReady){try{saveMemoSnapshot(chat);}catch(error){console.error('[Memo][structured] 失败基线快照保存也失败',error);}}console.error('[Memo][structured] 本轮table_edit校验/执行失败，已阻止旧宽松执行器兜底：',execution.error,tableEdit);EDITOR.warning(`一次API记录失败：${execution.error}。正文已保留，本轮未执行错误表格操作。`);}
    const persistence=persistChat('一次API结构化回复');setRuntimeField(chat,'__memoStrictPersistence',persistence);const persisted=await persistence;if(!persisted&&chat.__memoStrictExecution)chat.__memoStrictExecution.ok=false;delete chat.__memoStrictPersistence;
    if(pending.sessionChat&&USER?.getContext?.()?.chat!==pending.sessionChat){console.warn('[Memo][structured] 保存期间切换了聊天；旧回复已结束，不重绘当前新聊天页面');return;}
    try{const context=USER.getContext();if(typeof context?.updateMessageBlock==='function')context.updateMessageBlock(Number(chatId),chat);}catch(error){console.warn('[Memo][structured] 重绘正常正文失败，但不影响已完成的严格表格执行',error);}
    console.log(`[Memo][structured] 单次响应已拆包：${appendMode?'续写追加':'完整回复'}｜table_edit=${tableEdit==='NO_CHANGE'?'NO_CHANGE':execution.ok?`${execution.count}项`:'失败'}｜reply=${reply.length}字`);
}

const startedEvent=APP.event_types.GENERATION_STARTED;if(startedEvent)APP.eventSource.on(startedEvent,armGeneration);
const promptEvent=APP.event_types.CHAT_COMPLETION_PROMPT_READY;if(promptEvent){APP.eventSource.on(promptEvent,prepareStructuredPrompt);if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(promptEvent,prepareStructuredPrompt);}
const settingsEvent=APP.event_types.CHAT_COMPLETION_SETTINGS_READY;if(settingsEvent){APP.eventSource.on(settingsEvent,injectStructuredSchema);if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(settingsEvent,injectStructuredSchema);}
const renderedEvent=APP.event_types.CHARACTER_MESSAGE_RENDERED;APP.eventSource.on(renderedEvent,unpackStructuredReply);if(typeof APP.eventSource.makeFirst==='function')APP.eventSource.makeFirst(renderedEvent,unpackStructuredReply);
console.log('[Memo] 一次API结构化双通道已加载：严格执行器 + 分支基线 + Continue当前锚点 + 失败分支快照保护');
