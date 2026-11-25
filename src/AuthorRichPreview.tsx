import type { ReactNode } from 'react'
import type { RichNode } from './authorApi'
import { textDocument } from './authorRichText'

export function AuthorRichPreview({doc,text}:{doc?:RichNode;text:string}) {
  function render(node:RichNode,key:string):ReactNode {
    if(node.type==='text') {
      let result:ReactNode=node.text
      for(const mark of node.marks||[])result=mark.type==='bold'?<strong>{result}</strong>:mark.type==='italic'?<em>{result}</em>:result
      return <span key={key}>{result}</span>
    }
    const children=node.content?.map((child,i)=>render(child,`${key}-${i}`))
    if(node.type==='hardBreak')return <br key={key}/>
    switch(node.type) {
      case 'paragraph':return <p key={key}>{children||<br/>}</p>
      case 'heading':return node.attrs?.level===3?<h3 key={key}>{children}</h3>:<h2 key={key}>{children}</h2>
      case 'blockquote':return <blockquote key={key}>{children}</blockquote>
      case 'bulletList':return <ul key={key}>{children}</ul>
      case 'orderedList':return <ol key={key}>{children}</ol>
      case 'listItem':return <li key={key}>{children}</li>
      default:return <div key={key}>{children}</div>
    }
  }
  return <div className="studio-prose">{render(doc||textDocument(text),'preview')}</div>
}
