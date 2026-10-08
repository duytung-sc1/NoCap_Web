import { handleHttpsImport } from '../../server/httpsImport.ts'

export const onRequest = ({ request }: { request: Request }) => handleHttpsImport(request)
