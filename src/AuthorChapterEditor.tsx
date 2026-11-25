import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Heading2, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react'
import type { AuthorChapter, RichNode } from './authorApi'
import type { Lang } from './i18n'
import { normalizeDocument, textDocument } from './authorRichText'
import { contentLanguage } from './typography'

const extensions=[StarterKit.configure({code:false,codeBlock:false,horizontalRule:false,strike:false,link:false,underline:false,heading:{levels:[2,3]}})]
type Props={chapter:AuthorChapter;lang:Lang;contentLang:Lang;readOnly:boolean;onChange:(patch:{text:string;doc:RichNode})=>void;onSave:()=>void}
export function AuthorChapterEditor({chapter,lang,contentLang,readOnly,onChange,onSave}:Props){
 const vi=lang==='vi',change=useRef(onChange),save=useRef(onSave)
 useEffect(()=>{change.current=onChange;save.current=onSave},[onChange,onSave])
 const editor=useEditor({extensions,content:chapter.doc||textDocument(chapter.text),editable:!readOnly,immediatelyRender:false,shouldRerenderOnTransaction:false,editorProps:{attributes:{role:'textbox','aria-label':vi?'Nội dung chương':'Chapter content','aria-multiline':'true',class:'studio-prose',lang:contentLanguage(chapter.text,contentLang,lang)},handleKeyDown:(_view,event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save.current();return true}return false}},onUpdate:({editor})=>change.current({text:editor.getText({blockSeparator:'\n\n'}),doc:normalizeDocument(editor.getJSON() as RichNode)})})
 const state=useEditorState({editor,selector:({editor})=>({bold:editor?.isActive('bold'),italic:editor?.isActive('italic'),heading:editor?.isActive('heading'),bullet:editor?.isActive('bulletList'),ordered:editor?.isActive('orderedList'),quote:editor?.isActive('blockquote'),undo:editor?.can().undo(),redo:editor?.can().redo()})})
 useEffect(()=>{editor?.setEditable(!readOnly)},[editor,readOnly])
 useEffect(()=>{if(editor)editor.setOptions({editorProps:{...editor.options.editorProps,attributes:{...editor.options.editorProps.attributes,lang:contentLanguage(chapter.text,contentLang,lang)}}})},[editor,chapter.text,contentLang,lang])
 useEffect(()=>{if(!editor)return;const target=normalizeDocument(chapter.doc||textDocument(chapter.text));if(JSON.stringify(normalizeDocument(editor.getJSON() as RichNode))!==JSON.stringify(target))editor.commands.setContent(target,{emitUpdate:false})},[editor,chapter.doc,chapter.text])
 const tools=[{icon:Undo2,label:vi?'Hoàn tác':'Undo',disabled:!state?.undo,run:()=>editor?.chain().focus().undo().run()},{icon:Redo2,label:vi?'Làm lại':'Redo',disabled:!state?.redo,run:()=>editor?.chain().focus().redo().run()},{icon:Bold,label:vi?'In đậm':'Bold',active:state?.bold,run:()=>editor?.chain().focus().toggleBold().run()},{icon:Italic,label:vi?'In nghiêng':'Italic',active:state?.italic,run:()=>editor?.chain().focus().toggleItalic().run()},{icon:Heading2,label:vi?'Tiêu đề đoạn':'Heading',active:state?.heading,run:()=>editor?.chain().focus().toggleHeading({level:2}).run()},{icon:Quote,label:vi?'Trích dẫn':'Block quote',active:state?.quote,run:()=>editor?.chain().focus().toggleBlockquote().run()},{icon:List,label:vi?'Danh sách':'Bullet list',active:state?.bullet,run:()=>editor?.chain().focus().toggleBulletList().run()},{icon:ListOrdered,label:vi?'Danh sách đánh số':'Numbered list',active:state?.ordered,run:()=>editor?.chain().focus().toggleOrderedList().run()}]
 return <div className="studio-rich-editor"><div className="studio-formatting" role="toolbar" aria-label={vi?'Định dạng chương':'Chapter formatting'}>{tools.map(tool=><button key={tool.label} type="button" title={tool.label} aria-label={tool.label} aria-pressed={tool.active===undefined?undefined:!!tool.active} disabled={readOnly||!editor||tool.disabled} onMouseDown={e=>e.preventDefault()} onClick={tool.run}><tool.icon size={17}/></button>)}</div><EditorContent editor={editor}/>{!editor&&<p role="status">{vi?'Đang mở bàn viết…':'Opening editor…'}</p>}</div>
}
