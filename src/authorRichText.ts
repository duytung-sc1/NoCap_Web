import type { RichNode } from './authorApi'
/** Keep editor defaults and serialized API documents identical after a save. */
export function normalizeDocument(node: RichNode): RichNode {
 if(node.type==='text')return {type:'text',text:node.text||'',...(node.marks?.length?{marks:node.marks.map(m=>({type:m.type})).sort((a,b)=>a.type.localeCompare(b.type))}:{})}
 if(node.type==='hardBreak')return {type:'hardBreak'}
 const content=node.content?.map(normalizeDocument)
 return {type:node.type,...(node.type==='heading'?{attrs:{level:node.attrs?.level||2}}:node.type==='orderedList'?{attrs:{start:1}}:{}),...(content?.length?{content}:{})}
}
export function textDocument(text: string): RichNode {return {type:'doc',content:text.split(/\n\n+/u).map(paragraph=>({type:'paragraph',...(paragraph?{content:paragraph.split('\n').flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}:{})}))}}
