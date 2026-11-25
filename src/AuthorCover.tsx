import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { API_BASE, api } from './api'
import type { Lang } from './i18n'
export function AuthorCover({token,id,coverKey,className='',review=false}:{token:string;id:string;coverKey?:string;className?:string;review?:boolean}){
 const [image,setImage]=useState<{key:string;url:string}|null>(null)
 useEffect(()=>{if(!coverKey)return;const controller=new AbortController();let url='';const path=review?'admin/author-submissions':'author/works';void fetch(`${API_BASE}/api/v1/${path}/${id}/covers/${coverKey}.jpg`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();const blob=await response.blob();if(!controller.signal.aborted){url=URL.createObjectURL(blob);setImage({key:coverKey,url})}}).catch(()=>{});return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[token,id,coverKey,review])
 return <div className={`studio-cover ${className}`}>{image&&image.key===coverKey?<img src={image.url} alt=""/>:<BookOpen size={25} aria-hidden="true"/>}</div>
}
export async function uploadCover(token:string,id:string,file:File,lang:Lang,signal:AbortSignal){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error(lang==='vi'?'Chọn ảnh JPG, PNG hoặc WebP không quá 8 MB.':'Choose a JPG, PNG or WebP image up to 8 MB.')
 const url=URL.createObjectURL(file),image=new Image()
 try{image.src=url;await image.decode();signal.throwIfAborted();if(image.naturalWidth<150||image.naturalHeight<200||image.naturalWidth>10000||image.naturalHeight>10000)throw Error(lang==='vi'?'Ảnh cần tối thiểu 150 × 200 px và tối đa 10.000 px mỗi chiều.':'Use an image from 150 × 200 px up to 10,000 px per side.');const canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;const ctx=canvas.getContext('2d');if(!ctx)throw Error();const ratio=Math.max(600/image.naturalWidth,800/image.naturalHeight),w=image.naturalWidth*ratio,h=image.naturalHeight*ratio;ctx.drawImage(image,(600-w)/2,(800-h)/2,w,h);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error()),'image/jpeg',.86));signal.throwIfAborted();return await api<{coverKey:string}>(`/api/v1/author/works/${id}/covers`,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:blob,signal},token)}finally{URL.revokeObjectURL(url)}
}
