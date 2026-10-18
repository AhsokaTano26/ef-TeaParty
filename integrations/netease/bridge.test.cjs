const test = require('node:test')
const assert = require('node:assert/strict')
const { createDispatcher } = require('./bridge.cjs')

test('only music operations are callable and cookie never appears in errors', async () => {
 const dispatch = createDispatcher({
  song_detail: async () => ({body:{code:200,songs:[{id:7,name:'七'}]}}),
  song_url_v1: async () => { throw {message:'request cookie=SECRET',config:{cookie:'SECRET'}} },
 })
 assert.deepEqual(await dispatch({id:1,method:'song_detail',params:{ids:'7'}}),{id:1,result:{code:200,songs:[{id:7,name:'七'}]}})
 assert.match((await dispatch({id:2,method:'user_update',params:{}})).error,/不支持/)
 const failed=await dispatch({id:3,method:'song_url_v1',params:{cookie:'SECRET'}})
 assert.equal(failed.id,3)
 assert.doesNotMatch(JSON.stringify(failed),/SECRET/)
})

test('playback explicitly uses account permissions without other audio sources', async () => {
 let received
 const dispatch=createDispatcher({song_url_v1:async params=>{received=params;return{body:{code:200,data:[]}}}})
 await dispatch({id:4,method:'song_url_v1',params:{id:'7',cookie:'account',unblock:'true',source:'other'}})
 assert.equal(received.unblock,'false')
 assert.equal(received.level,'standard')
 assert.equal(received.source,undefined)
 assert.equal(received.cookie,'account')
 assert.equal(received.timeout,15000)
 assert.equal(received.crypto,'weapi')
})
