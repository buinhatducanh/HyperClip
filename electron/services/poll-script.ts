// Poll script injected into the PollWindow
// This is loaded at runtime to avoid TypeScript compiler truncating large string arrays.
const POLL_SCRIPT = `(function(){
function c(){
var seen=new Set(),I=3000,WARMUP=true;
// WARMUP=true: populate seen Set but don't emit (skip old videos on startup).
// seen Set only dedups WITHIN a single scan (to skip duplicate DOM nodes for same video).
// Cross-scan dedup is handled by seen-videos.json in the main process.
// Parse YouTube relative time (e.g. '2 hours ago', '3 days ago', 'Streamed 1 hour ago') -> minutes ago
function parseAgeMinutes(pub){
if(!pub)return 999;
var s=pub.toLowerCase();
// Streamed prefix
s=s.replace('streamed ','');
var m;
if(m=s.match(/(\\d+)\\s*second/i))return Math.floor(parseInt(m[1])/60);
if(m=s.match(/(\\d+)\\s*hour/i))return parseInt(m[1])*60;
if(m=s.match(/(\\d+)\\s*day/i))return parseInt(m[1])*60*24;
if(m=s.match(/(\\d+)\\s*week/i))return Math.floor(parseInt(m[1])*60*24*7);
if(m=s.match(/(\\d+)\\s*month/i))return Math.floor(parseInt(m[1])*60*24*30);
if(m=s.match(/(\\d+)\\s*minute/i))return parseInt(m[1]);
if(s.indexOf('yesterday')!==-1)return 60*24;
if(s.indexOf('today')!==-1)return 0;
return 999;
}
// Only auto-ingest videos published within MAX_AGE_MINUTES
var MAX_AGE_MINUTES=90;
function emit(vid,title,cid,cn,thumb,dur,pub,ch){
if(seen.has(vid)){return;}
var age=parseAgeMinutes(pub);
// Only skip videos with KNOWN age older than MAX_AGE_MINUTES. age=999 (unknown) passes through.
if(age!==999&&age>MAX_AGE_MINUTES){console.log('[PollDBG] SKIP old vid='+vid+', age='+age+'m');return;}
seen.add(vid);
// WARMUP=true: populate seen Set but don't emit anything yet
if(WARMUP){console.log('[PollDBG] WARMUP seen vid='+vid+', age='+age+'m, title='+title.substring(0,30));return;}
console.log('[PollDBG] EMIT vid='+vid+', cid='+cid+', ch='+(ch||'')+', age='+age+'m, title='+title.substring(0,40));
console.log('__HCPOLL__'+JSON.stringify({videoId:vid,title:title,channelId:cid,channelName:cn,thumbnail:thumb,duration:dur,publishedTime:pub,channelHandle:ch||''}));
}
// Extract video data from a videoRenderer-like object
function extractVideo(vr,prefix){
if(!vr)return;
var vid=vr.videoId||'';
if(!vid||vid.length<5)return;
var tl=(vr.title&&vr.title.runs||[]).map(function(r){return r.text||'';}).join('');
var sb=vr.shortBylineText&&vr.shortBylineText.runs||vr.longBylineText&&vr.longBylineText.runs||[];
var cn=sb.map(function(r){return r.text||'';}).join('');
var cid='';sb.forEach(function(r){var ep=r.navigationEndpoint&&r.navigationEndpoint.browseEndpoint;if(ep&&ep.browseId&&ep.browseId.startsWith('UC'))cid=ep.browseId;});
var th=(vr.thumbnail&&vr.thumbnail.thumbnails)||[];var thumb=th.length?th[th.length-1].url||'':'';
if(thumb&&thumb.startsWith('//'))thumb='https:'+thumb;
if(!thumb)thumb='https://img.youtube.com/vi/'+vid+'/hqdefault.jpg';
var dur=(vr.lengthText&&vr.lengthText.simpleText)||(vr.lengthText&&vr.lengthText.accessibility&&vr.lengthText.accessibility.accessibilityData&&vr.lengthText.accessibility.accessibilityData.label)||'';
var pub=(vr.publishedTimeText&&vr.publishedTimeText.runs||[]).map(function(r){return r.text||'';}).join('');
emit(vid,tl,cid,cn,thumb,dur,pub);
}
// Walk a path in ytInitialData for video renderers
function walkYtData(obj,depth){
if(!obj||typeof obj!=='object'||depth>15)return;
if(Array.isArray(obj)){obj.forEach(function(x){walkYtData(x,depth+1);});return;}
// richItemRenderer
if(obj.richItemRenderer&&obj.richItemRenderer.content){
extractVideo(obj.richItemRenderer.content.videoRenderer,'ri');
}
// videoRenderer (direct)
if(obj.videoRenderer&&obj.videoRenderer.videoId){
extractVideo(obj.videoRenderer,'vr');
}
// gridVideoRenderer
if(obj.gridVideoRenderer&&obj.gridVideoRenderer.videoId){
extractVideo(obj.gridVideoRenderer,'gv');
}
Object.values(obj).forEach(function(v){walkYtData(v,depth+1);});
}
// Navigate ytInitialData via known YouTube structure paths
function scanYtInitialData(){
var data=window.ytInitialData;
if(!data){console.log('[PollDBG] ytInitialData not ready');return;}
var found=0;
try{
// Path 1: contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents
var tabs=data.contents&&data.contents.twoColumnBrowseResultsRenderer&&data.contents.twoColumnBrowseResultsRenderer.tabs||[];
for(var t=0;t<tabs.length;t++){
var tab=tabs[t];
var sec=tab&&tab.tabRenderer&&tab.tabRenderer.content&&tab.tabRenderer.content.sectionListRenderer&&tab.tabRenderer.content.sectionListRenderer.contents||[];
for(var s=0;s<sec.length;s++){
var itemSec=sec[s];
var items=itemSec&&itemSec.itemSectionRenderer&&itemSec.itemSectionRenderer.contents||[];
for(var it=0;it<items.length;it++){
var ri=items[it]&&items[it].richItemRenderer&&items[it].richItemRenderer.content;
if(ri&&ri.videoRenderer)extractVideo(ri.videoRenderer,'p1');found++;
if(items[it].richItemRenderer)walkYtData(items[it].richItemRenderer,0);
}
}
}
// Path 2: onResponseReceivedActions (continuation data)
var actions=data.onResponseReceivedActions||[];
for(var a=0;a<actions.length;a++){
var act=actions[a];
walkYtData(act,0);
}
// Path 3: continuationContents
if(data.continuationContents){walkYtData(data.continuationContents,0);}
}catch(e){console.log('[PollDBG] ytInitialData walk error: '+e.message);}
console.log('[PollDBG] ytInitialData scan done, seen:'+seen.size+', found:'+found);
}
// DOM scan: get video links from page
function scanDOM(){
var links=document.querySelectorAll('a[href*="/watch?v="]');
var emitted=0;
for(var i=0;i<links.length;i++){
var a=links[i];
var href=a.getAttribute('href')||'';
var m=href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
if(!m)continue;
var vid=m[1];
// Get title from parent element's metadata (not link text which is duration)
var parent=a.closest('ytd-rich-item-renderer,ytd-grid-video-renderer,[id*="video"],div')||a.parentElement;
var titleEl=parent&&(parent.querySelector('#video-title,#title,h3 a,yt-formatted-string[id*="title"]')||a);
var title=(titleEl&&titleEl.getAttribute('title'))||(titleEl&&titleEl.textContent)||'';
title=title.trim().substring(0,200);
// Get channel name
var cnEl=parent&&parent.querySelector('#channel-name a,yt-formatted-string[id*="byline"],.short-byline,.yt-formatted-string a,span.yt-formatted-string');
var cn=(cnEl&&cnEl.textContent)||'';cn=cn.trim();
// Get thumbnail
var imgEl=parent&&parent.querySelector('img');
var thumb=(imgEl&&imgEl.src)||'';
if(thumb&&thumb.startsWith('//'))thumb='https:'+thumb;
// Extract channelId from nearby channel link (handle both /channel/UC and /@handle URLs)
var cid='';
var chandle='';
var channelLink=parent&&parent.querySelector('a[href*="/channel/UC"],a[href*="/@"],a[href*="/user/"]');
if(channelLink){
var chref=channelLink.getAttribute('href')||'';
var cm=chref.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
if(cm&&cm[1]){cid=cm[1];}
else{var hm=chref.match(/\/(@[^/?#]+)/);if(hm&&hm[1])chandle=hm[1];}
}
emit(vid,title,cid,cn,thumb,'','',chandle);
emitted++;
}
console.log('[PollDBG] DOM scanned: '+links.length+' links, emitted:'+emitted+', seen:'+seen.size);
}
// MutationObserver for real-time new videos
function setupObserver(){
var observer=new MutationObserver(function(mutations){
for(var mi=0;mi<mutations.length;mi++){
var nodes=mutations[mi].addedNodes;
for(var ni=0;ni<nodes.length;ni++){
var node=nodes[ni];
if(node.nodeType!==1)continue;
var links=node.querySelectorAll?node.querySelectorAll('a[href*="/watch?v="]'):[];
for(var li=0;li<links.length;li++){
var a=links[li];
var href=a.getAttribute('href')||'';
var m=href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
if(!m)continue;
var vid=m[1];
var title=(a.getAttribute('title')||a.textContent||'').trim().substring(0,200);
var parent=node.querySelector?node:node.parentElement;
var cnEl=parent&&parent.querySelector('#channel-name a,.short-byline');
var cn=(cnEl&&cnEl.textContent)||'';
var imgEl=parent&&parent.querySelector('img');
var thumb=(imgEl&&imgEl.src)||'';
if(thumb&&thumb.startsWith('//'))thumb='https:'+thumb;
// Extract channelId (handle both /channel/UC and /@handle URLs)
var cid='';
var chandle='';
var channelLink=parent&&parent.querySelector('a[href*="/channel/UC"],a[href*="/@"],a[href*="/user/"]');
if(channelLink){
var chref=channelLink.getAttribute('href')||'';
var cm=chref.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
if(cm&&cm[1]){cid=cm[1];}
else{var hm=chref.match(/\/(@[^/?#]+)/);if(hm&&hm[1])chandle=hm[1];}
}
emit(vid,title,cid,cn.trim(),thumb,'','',chandle);
}
}
}
});
observer.observe(document.body,{childList:true,subtree:true});
return observer;
}
// Start -- warmup: scan without emitting to populate seen Set first
setTimeout(function(){scanYtInitialData();scanDOM();setupObserver();},3000);
// After warmup scan, normal polling (seen Set now blocks old videos)
setTimeout(function(){
WARMUP=false;
console.log('[PollDBG] Warmup done -- seen:'+seen.size+', switching to live mode');
setInterval(function(){scanYtInitialData();scanDOM();},I);
},15000);
try{c()}catch(e){console.error('[PollWindow][script-error] '+e.message+' at '+(e.lineNumber||'?'));}
}
})()
`

export default POLL_SCRIPT