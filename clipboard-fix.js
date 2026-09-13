document.addEventListener('click',async event=>{
  const button=event.target.closest?.('#clipboard');
  if(!button)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const status=document.querySelector('#status');
  const input=document.querySelector('#file');
  if(status)status.textContent='Reading clipboard screenshot…';
  button.disabled=true;
  let timer;
  try{
    if(!navigator.clipboard?.read)throw new Error('unsupported');
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),5000);});
    const items=await Promise.race([navigator.clipboard.read(),timeout]);
    clearTimeout(timer);
    let image=null;
    for(const item of items){
      const type=item.types.find(t=>t.startsWith('image/'));
      if(type){image=await item.getType(type);break;}
    }
    if(!image){if(status)status.textContent='No image found on the clipboard. Copy or share the screenshot and try again.';return;}
    if(!input)throw new Error('input');
    const file=new File([image],'clipboard-screenshot',{type:image.type||'image/png'});
    const transfer=new DataTransfer();
    transfer.items.add(file);
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(error){
    clearTimeout(timer);
    if(status)status.textContent=error?.message==='timeout'?'Clipboard access timed out. Tap again or use Upload screenshot.':'Clipboard access was blocked. Tap Upload screenshot instead.';
  }finally{
    button.disabled=false;
  }
},true);
