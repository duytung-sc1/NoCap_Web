// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AdminAuthorSubmissions } from './AdminAuthorSubmissions'
import { adminRequest } from './api'
import type { AuthorWork } from '../authorApi'
vi.mock('./api',()=>({adminRequest:vi.fn()}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('opens only the published edition and offers suspension rather than approval',async()=>{
  const work:AuthorWork={id:'author-public',revision:7,status:'draft',reviewNote:'',published:true,updatedAt:'2026-11-24',manuscript:{title:'Bản công khai',penName:'Mai',categoryId:'fiction',description:'Giới thiệu',language:'vi',chapters:[{id:'one',title:'Chương đã đăng',text:'Nội dung công khai'}]}}
  vi.mocked(adminRequest).mockImplementation(async(_token,path)=>path==='author-submissions'?{items:[]} as never:path==='author-submissions?view=published'?{items:[{...work,title:'Bản công khai',chapters:1}]} as never:work as never)
  render(<AdminAuthorSubmissions token="admin-session" lang="vi" onFailure={()=>'Lỗi'} onCatalogChanged={vi.fn()}/>);
  await screen.findByText('Không có tác phẩm chờ duyệt.')
  fireEvent.click(screen.getByRole('button',{name:'Đang công khai'}))
  fireEvent.change(await screen.findByRole('combobox'),{target:{value:work.id}})
  await screen.findByRole('heading',{name:'Bản công khai'})
  expect(adminRequest).toHaveBeenCalledWith('admin-session','author-submissions/author-public?view=published',expect.any(AbortSignal))
  expect(screen.queryByRole('button',{name:'Duyệt & công khai'})).toBeNull()
  expect(screen.getByRole('button',{name:'Gỡ bản đang công khai'})).toBeTruthy()
})
it('loads only the selected submission and sends revision and reason using the real admin request contract',async()=>{
  const work: AuthorWork={id:'author-test',revision:3,status:'pending',reviewNote:'',published:false,updatedAt:'2026-11-24T01:00:00Z',manuscript:{title:'Tác phẩm',penName:'Mai',categoryId:'fiction',description:'Giới thiệu',language:'vi',chapters:[{id:'one',title:'Chương một',text:'<script>not executed</script>'}]}}
  vi.mocked(adminRequest).mockImplementation(async (_token,path)=>path==='author-submissions'?{items:[{...work,manuscript:undefined,title:'Tác phẩm',penName:'Mai',chapters:1}]} as never:path==='author-submissions/author-test'?work as never:{success:true} as never)
  const changed=vi.fn();render(<AdminAuthorSubmissions token="admin-session" lang="vi" onFailure={()=>'Lỗi duyệt'} onCatalogChanged={changed}/>);
  fireEvent.change(await screen.findByRole('combobox'),{target:{value:'author-test'}})
  await screen.findByRole('heading',{name:'Tác phẩm'})
  fireEvent.click(screen.getByText('1. Chương một'))
  expect(screen.getByText('<script>not executed</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Đã kiểm tra quyền xuất bản.'}})
  fireEvent.click(screen.getByRole('button',{name:'Duyệt & công khai'}))
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
  expect(adminRequest).toHaveBeenCalledWith('admin-session','author-submissions/author-test/approve',expect.any(AbortSignal),{revision:3,reason:'Đã kiểm tra quyền xuất bản.'})
})
