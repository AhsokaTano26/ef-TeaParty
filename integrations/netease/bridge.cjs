const METHODS = new Set(['health','login_qr_key','login_qr_create','login_qr_check','login_status','user_playlist','playlist_detail','song_detail','song_url_v1'])

function createDispatcher(sdk) {
 return async function dispatch(message) {
  const {id,method,params={}}=message
  if (!Number.isSafeInteger(id) || !METHODS.has(method)) return {id,error:'不支持的网易云操作'}
  if(method==='health') return {id,result:{ready:true}}
  try {
   const safe={...params}
   delete safe.proxy
   delete safe.source
   delete safe.randomCNIP
   if(method==='song_url_v1') Object.assign(safe,{unblock:'false',level:'standard'})
   const result=await sdk[method](safe)
   return {id,result:result.body}
  } catch (error) {
   // Never serialize SDK errors: their request configuration may include cookies.
   const code=Number(error?.body?.code || error?.status || 0)
   return {id,error:code===301?'网易云登录已失效，请重新扫码':'网易云请求失败，请稍后重试',code}
  }
 }
}

if(require.main===module) {
 // Third-party loggers must not contaminate IPC or print account credentials.
 console.log=console.info=console.warn=console.error=console.debug=()=>{}
 process.env.ENABLE_GENERAL_UNBLOCK='false'
 let sdk
 try { sdk=require('@neteasecloudmusicapienhanced/api') } catch { process.exit(78) }
 const dispatch=createDispatcher(sdk)
 const rl=require('node:readline').createInterface({input:process.stdin,crlfDelay:Infinity})
 let active=0
 rl.on('line',async line=>{
  let message
  try {
   if(Buffer.byteLength(line)>1024*1024) throw new Error()
   message=JSON.parse(line)
  } catch { return }
  if(active>=16) {
   process.stdout.write(JSON.stringify({id:message.id,error:'网易云请求过多，请稍后重试'})+'\n')
   return
  }
  active++
  try {
   const response=await dispatch(message)
   const output=JSON.stringify(response)
   process.stdout.write((Buffer.byteLength(output)<=8*1024*1024?output:JSON.stringify({id:message.id,error:'网易云响应过大'}))+'\n')
  } finally { active-- }
 })
 rl.on('close',()=>process.exit(0))
}
module.exports={createDispatcher}
