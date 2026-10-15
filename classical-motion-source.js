export function createLivingMotions(api){
 const {THREE,entries,add,modeMap,match,exact,unique,boxOf,middle,pose,deform,scaleParts,light,explain,source,basis,cacheVertices,endpoint,sideBones,isHand,isFoot}=api;
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),TAU=2*Math.PI;
 const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
 const wave=p=>(1-Math.cos(TAU*p))/2,st=()=>api.getState(),amp=()=>st().amplitude;
 const bump=(p,start,peak,end)=>p<peak?smooth((p-start)/(peak-start)):1-smooth((p-peak)/(end-peak));
 const gate=p=>smooth(p/.065)*smooth((1-p)/.065);
 const breath=p=>p<.4?smooth(p/.4):1-smooth((p-.4)/.6);
 const fields=new Map(),flows=new Map(),motionModes=[];
 function register(m){if(!m.targets?.length)return;m.kind=m.kind||'连续形变与联动';add(m);motionModes.push(m);}
 function enhance(id,values){const old=modeMap.get(id);if(old)Object.assign(old,values);return old;}
 function chooseSide(e){return st().side==='both'||e.motionName.endsWith(st().side);}
 // Smooth center estimates along the largest dimension; individual tubes remain separate.
 function field(e){
  if(fields.has(e))return fields.get(e);
  const size=e.motionSize,axis=['x','y','z'].reduce((a,b)=>size[a]>size[b]?a:b),lo=e.motionBox.min[axis],span=Math.max(size[axis],1e-6);
  const centers=Array.from({length:40},()=>({sum:V(),n:0}));
  for(const mesh of e.meshes){const a=cacheVertices(mesh).anatomical,stride=Math.max(1,Math.ceil(a.length/3/16000));
   for(let i=0;i<a.length;i+=stride*3){const p=V().fromArray(a,i),bin=Math.min(39,Math.floor(clamp((p[axis]-lo)/span)*40));centers[bin].sum.add(p);centers[bin].n++;}}
  for(const c of centers)if(c.n)c.sum.multiplyScalar(1/c.n);
  for(let i=0;i<40;i++)if(!centers[i].n){let best=0,d=Infinity;for(let j=0;j<40;j++)if(centers[j].n&&Math.abs(i-j)<d){best=j;d=Math.abs(i-j);}centers[i].sum.copy(centers[best].sum);}
  const points=centers.map((c,i)=>{const p=c.sum.clone();if(i>0&&i<39)p.add(centers[i-1].sum).add(centers[i+1].sum).multiplyScalar(1/3);p[axis]=lo+span*(i+.5)/40;return p;});
  const value={axis,lo,span,points};fields.set(e,value);return value;
 }
 function curveAt(f,t,out){const n=clamp(t)*39,k=Math.min(38,Math.floor(n));return out.copy(f.points[k]).lerp(f.points[k+1],n-k);}
 function tube(e,p,{strength=.22,cycles=1,direction=-1,segmented=false}={}){
  const f=field(e),c=V(),a=amp()*gate(p)*gate(st().phase);
  deform(e,v=>{const u=clamp((v[f.axis]-f.lo)/f.span);curveAt(f,u,c);
   const q=segmented?(.5+.5*Math.cos(TAU*(u*5+p))):Math.exp(-(((u-(direction<0?1.2-1.4*p:-.2+1.4*p))/.14)**2));
   const contraction=strength*a*q*(segmented?wave(p):1);
   for(const key of ['x','y','z'])if(key!==f.axis)v[key]=c[key]+(v[key]-c[key])*(1-contraction);
  });
 }
 function soft(e,q,{shorten=.08,bulge=.035,twist=0,axis='z',anchor=0}={}){
  const c=e.motionCenter,b=e.motionBox,size=Math.max(e.motionSize[axis],1e-6),others=['x','y','z'].filter(k=>k!==axis);
  deform(e,v=>{const u=clamp((v[axis]-b.min[axis])/size),belly=Math.sin(Math.PI*u),weight=anchor?smooth(u)*belly:belly;
   const t=twist*q*(u-.5),cs=Math.cos(t),sn=Math.sin(t),x=v[others[0]]-c[others[0]],y=v[others[1]]-c[others[1]];
   v[others[0]]=c[others[0]]+(x*cs-y*sn)*(1+bulge*q*weight);
   v[others[1]]=c[others[1]]+(x*sn+y*cs)*(1+bulge*q*weight);
   v[axis]-=(v[axis]-(anchor?b.min[axis]:c[axis]))*shorten*q*weight;
  });
 }
 function particle(e,p,{color=0xffcf62,direction=-1,cloud=false,count=18}={}){
  if(!st().flow||!amp()||p===0)return;
  let fx=flows.get(e);
  if(!fx){
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
   const material=new THREE.PointsMaterial({color,size:Math.max(.0012,Math.min(.004,e.motionSize.length()*.018)),transparent:true,opacity:.78,depthWrite:false,depthTest:false,sizeAttenuation:true});
   // Round soft dots instead of square point sprites; no external textures.
   material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat r = length(gl_PointCoord - vec2(0.5)); if (r > 0.5) discard; diffuseColor.a *= 1.0 - smoothstep(0.12,0.5,r);');};
   const object=new THREE.Points(geometry,material);object.userData.bio2meshFlow=true;object.renderOrder=5;object.frustumCulled=false;e.motion.add(object);
   fx={object,count};flows.set(e,fx);
  }
  const object=fx.object;object.visible=true;object.material.color.set(color);object.material.opacity=.78*amp()*gate(p);
  object.material.clippingPlanes=e.meshes[0]?.material.clippingPlanes||[];
  const a=object.geometry.attributes.position.array,f=field(e),v=V();
  for(let i=0;i<fx.count;i++){
   const t=(i/fx.count+p*1.7)%1;
   if(cloud){const theta=i*2.39996,rad=.16+.65*t;v.set(e.motionCenter.x+Math.cos(theta)*e.motionSize.x*.48*rad,e.motionCenter.y+Math.sin(theta)*e.motionSize.y*.48*rad,e.motionCenter.z+Math.sin(theta*1.31+TAU*p)*e.motionSize.z*.35*rad);}
   else curveAt(f,direction<0?1-t:t,v);
   v.applyMatrix4(basis).toArray(a,i*3);
  }
  object.geometry.attributes.position.needsUpdate=true;
 }
 const atria=match(/^(left|right) atrium$/),ventricles=match(/^(left|right) ventricle$/),valves=match(/leaflet/),papillary=match(/papillary muscle/);
 const arteries=match(/^(ascending aorta|arch of aorta|thoracic aorta|abdominal aorta|pulmonary trunk|left pulmonary artery|right pulmonary artery)$/);
 const veins=match(/^(superior|inferior) vena cava$|^(left|right) (superior|inferior) pulmonary vein$/);
 function valveMotion(p){
  const systole=bump(p,.18,.3,.66)*amp();
  for(const e of valves){const semilunar=/semilunar|coronary leaflet/.test(e.motionName),q=(semilunar?1:-1)*systole,c=e.motionCenter;
   // Bend the free interior more than its surrounding attachment ring.
   deform(e,v=>{const dx=(v.x-c.x)/Math.max(e.motionSize.x,.0001),dz=(v.z-c.z)/Math.max(e.motionSize.z,.0001),w=Math.max(0,1-2*Math.hypot(dx,dz));v.y+=q*Math.max(e.motionSize.length()*.12,.0006)*w;v.z+=q*e.motionSize.z*.16*w;});
  }
 }
 const oldHeartbeat=modeMap.get('heartbeat')?.apply;
 function heart(p,flow=false){
  const a=bump(p,.03,.14,.23)*amp(),q=bump(p,.22,.39,.64)*amp();
  for(const e of atria)scaleParts([e],e.motionCenter,[1-.025*a,1-.025*a,1-.04*a]);
  if(ventricles.length)scaleParts(unique([ventricles,papillary]),middle(ventricles),[1-.035*q,1-.035*q,1-.055*q]);
  for(const e of atria)soft(e,a,{shorten:.04,bulge:-.055});
  for(const e of [...ventricles,...papillary])soft(e,q,{shorten:.035,bulge:-.035,twist:e.motionName.startsWith('left')?.20:.08});
  valveMotion(p);
  if(flow)for(const e of arteries){tube(e,p,{strength:-.08});particle(e,p,{color:0xfa7f72,direction:e.motionName==='ascending aorta'?1:-1});}
  explain(p<.22?'心房收缩 · 心室继续充盈':p<.64?'心室扭转收缩 · 瓣膜协同射血':'心肌舒张 · 弹性回位','心肌与瓣膜协调活动，血液沿通路流动。',[...atria,...ventricles]);
 }
 if(oldHeartbeat){
  enhance('heartbeat',{apply:p=>heart(p),duration:.9,description:'心房先收缩，心室随后缩短并轻度扭转；瓣膜随充盈与射血阶段开合，舒张时回位。'});
  enhance('valve-cycle',{apply:p=>{valveMotion(p);explain(p<.2||p>.66?'房室瓣充盈阶段':'心室射血阶段','通过瓣叶自由缘的弯曲观察两个阶段。',valves);},kind:'瓣叶形变示意',description:'已有瓣叶随心动周期弯曲，模拟开放与关闭的相对变化；附着环保持稳定。'});
  register({id:'cardiac-living',label:'心脏、瓣膜与血流联动',group:'器官联动',targets:unique([atria,ventricles,valves,papillary,arteries]),focusTargets:unique([atria,ventricles,valves]),duration:.9,priority:100,source:source.heart,description:'观察心肌收缩、瓣膜开合与血流方向的联动。',apply:p=>heart(p,true)});
  register({id:'ventricular-twist',label:'心室扭转与舒张回弹',group:'生理过程',targets:ventricles,duration:1.4,source:'https://pubmed.ncbi.nlm.nih.gov/11545133/',description:'沿心室长轴观察扭转收缩，再观察舒张时的回弹。',apply(p){for(const e of ventricles)soft(e,bump(p,.12,.42,.8)*amp(),{shorten:.07,bulge:-.09,twist:.3});explain(p<.45?'扭转与缩短':'舒张与回弹','心室各高度的旋转角不同。',ventricles);}});
 }
 if(arteries.length)register({id:'arterial-pulse',label:'动脉脉搏波传播',targets:arteries,duration:1.2,source:source.blood,description:'观察脉搏引起的管壁扩张，沿动脉逐段传播。',apply(p){for(const e of arteries){tube(e,p,{strength:-.11});particle(e,p,{color:0xff8676,direction:e.motionName==='ascending aorta'?1:-1});}explain('管壁局部扩张随脉搏传播','观察相邻位置先后膨起。',arteries);}});
 if(veins.length)register({id:'venous-return',label:'静脉回流与呼吸性变化',targets:veins,duration:5,source:source.blood,description:'观察静脉血回流的方向，以及管壁随呼吸产生的轻度起伏。',apply(p){for(const e of veins){soft(e,breath(p)*amp(),{shorten:0,bulge:.025});particle(e,p,{color:0x77b8f7,direction:/superior vena/.test(e.motionName)?-1:1});}explain('回流持续 · 管壁轻度起伏','可关闭粒子，只观察管壁。',veins);}});

 const lobes=match(/lobe of (left|right) lung/),bronchi=match(/lobar bronchus|segmental bronchus|^(left|right) main bronchus$/);
 const lungRigs=['left','right'].map(side=>{const parts=lobes.filter(e=>e.motionName.includes(side));return {side,parts,box:parts.length?boxOf(parts):null};}).filter(r=>r.parts.length);
 function lungs(p,depth=1){
  const q=breath(p)*amp()*depth;
  for(const rig of lungRigs){const c=rig.box.getCenter(V()),span=Math.max(rig.box.max.z-rig.box.min.z,.0001),targets=unique([rig.parts,bronchi.filter(e=>e.motionName.includes(rig.side))]);
   for(const e of targets){
    pose(e,V(c.x,c.y,rig.box.max.z),V(1,0,0),0,[1+.012*q,1+.016*q,1+.009*q]);
    deform(e,v=>{const basal=clamp((rig.box.max.z-v.z)/span),w=.15+.85*smooth(basal);v.x+=(v.x-c.x)*.035*q*w;v.y+=(v.y-c.y)*.055*q*w;v.z-=span*.042*q*w;});
   }
  }
  explain(p<.4?'吸气 · 肺底和胸廓方向扩张':'呼气 · 肺组织缓慢回缩','肺叶和同侧支气管使用相同位移场，保持空间联系。',lobes);
 }
 if(lobes.length){
  enhance('breathing',{targets:unique([lobes,bronchi]),apply:p=>lungs(p),description:'肺底的扩张比肺尖明显；肺叶和同侧支气管随同一个连续位移场移动。吸气较快，呼气缓慢回位。'});
  register({id:'breathing-coupled',label:'肺叶、支气管与气流联动',group:'器官联动',targets:unique([lobes,bronchi]),duration:5,priority:95,source:source.breath,description:'观察吸气与呼气时，肺叶、支气管和气流的协同变化。',apply(p){lungs(p);for(const e of bronchi.filter(e=>/main bronchus/.test(e.motionName)))particle(e,p,{color:0x86dfef,direction:p<.4?-1:1});}});
  register({id:'deep-breath',label:'深吸气与缓慢呼气',targets:unique([lobes,bronchi]),duration:8,source:source.breath,description:'延长呼吸周期并增大肺底形变，便于比较吸气末与呼气末的外形。',apply:p=>lungs(p,1.65)});
  register({id:'sigh',label:'叹息样呼吸节律',targets:unique([lobes,bronchi]),duration:9,source:source.breath,description:'用一次较深吸气和较长呼气展示不同呼吸节律下的外形变化。',apply(p){const t=p<.3?p/.3*.4:.4+(p-.3)/.7*.6;lungs(t,1.4);}});
 }

 const stomach=match(/^(stomach|mucosa of stomach)$/),small=match(/^(duodenum|jejunum|ileum)$/),colon=match(/^(ascending|transverse|descending|sigmoid) colon$/),gall=match(/^gallbladder$/),esophagus=match(/^(oesophagus|esophagus)$/);
 const tongue=match(/^tongue$/),palate=match(/^soft palate$|^uvula of palate$/),pharynx=match(/^(oropharynx|laryngopharynx)$/),epiglottis=exact('epiglottis');
 function stomachWave(p){for(const e of stomach){tube(e,p,{strength:.18,direction:1});softPose(e,p);}}
 function softPose(e,p){pose(e,e.motionCenter,V(0,0,1),.025*Math.sin(TAU*p)*amp());}
 if(stomach.length)register({id:'stomach-wave',label:'胃壁推进波与搅拌',targets:stomach,duration:6,source:source.digest,description:'局部收缩沿胃壁移动，同时叠加轻微扭动，展示混合与推进的形态概念。',apply(p){stomachWave(p);explain('局部收缩波沿胃壁推进','观察收缩位置随时间移动。',stomach);}});
 for(const [id,label,segmented] of [['intestine-segmentation','小肠分节运动',true],['intestine-peristalsis','小肠局部蠕动',false]])if(small.length)register({id,label,targets:small,duration:7,source:source.digest,description:'肠壁不同位置交替收缩，帮助混合并推进肠内容物。',apply(p){small.forEach(e=>tube(e,p,{strength:.2,segmented}));explain(segmented?'相邻肠段交替收缩':'局部收缩逐渐推进','形变用于观察肠壁运动。',small);}});
 if(colon.length)register({id:'colon-haustral',label:'结肠袋交替收缩',targets:colon,duration:8,source:source.digest,description:'在已有结肠外形上叠加分段收缩和舒张，帮助观察缓慢的混合运动。',apply(p){colon.forEach((e,i)=>tube(e,(p+i*.06)%1,{strength:.13,segmented:true}));explain('结肠不同位置交替收缩','拖动进度观察袋状外形变化。',colon);}});
 if(gall.length)register({id:'gallbladder-emptying',label:'胆囊缓慢收缩与恢复',targets:gall,duration:9,source:source.digest,description:'胆囊壁缓慢收缩，示意储存胆汁排出时的外形变化；周期经过压缩以便观察。',apply(p){gall.forEach(e=>soft(e,wave(p)*amp(),{shorten:.2,bulge:-.18,anchor:1}));explain(p<.5?'胆囊壁缓慢收缩':'回到起始外形','观察胆囊壁的收缩与回位。',gall);}});
 if(esophagus.length||tongue.length||epiglottis)register({id:'swallow-coupled',label:'舌、咽、会厌与食管联动',group:'器官联动',targets:unique([tongue,palate,pharynx,epiglottis?[epiglottis]:[],esophagus]),duration:4.5,source:source.swallow,description:'依次观察舌体活动、软腭抬升、咽部收缩、会厌倾转和食管蠕动。',apply(p){
  for(const e of tongue)soft(e,bump(p,.02,.18,.4)*amp(),{shorten:.08,bulge:.05,twist:.08});
  for(const e of palate)pose(e,e.motionCenter,V(1,0,0),-.22*bump(p,.08,.3,.62)*amp());
  for(const e of pharynx)soft(e,bump(p,.2,.43,.65)*amp(),{shorten:.05,bulge:-.1});
  if(epiglottis){const pivot=epiglottis.motionCenter.clone();pivot.z=epiglottis.motionBox.min.z;pose(epiglottis,pivot,V(1,0,0),-.55*bump(p,.12,.36,.63)*amp());}
  for(const e of esophagus)tube(e,clamp((p-.32)/.68),{strength:.25});
  explain(p<.3?'口腔准备与软腭抬升':p<.6?'咽部推进与喉入口保护':'食管收缩波下传','各部件按先后关系联动。');
 }});
 if(stomach.length&&small.length)register({id:'digestion-coupled',label:'胃肠节律联动',group:'器官联动',targets:unique([stomach,small,colon]),duration:10,priority:90,source:source.digest,description:'胃壁推进波与肠道分节运动同时播放，各段节律略有错开，展示持续的消化道活动。',apply(p){stomachWave(p);small.forEach(e=>tube(e,p,{segmented:true,strength:.17}));colon.forEach(e=>tube(e,p,{segmented:true,strength:.1}));explain('胃壁推进 · 肠道交替收缩','可分别选择单个器官的演示进行观察。');}});

 const ureters=match(/^ureter (left|right)$/),bladder=match(/^urinary bladder$/),urethra=match(/^urethra$/);
 function bladderShape(p){bladder.forEach(e=>soft(e,wave(p)*amp(),{shorten:-.20,bulge:.22,anchor:1}));}
 if(ureters.length){
  register({id:'ureter-alternate',label:'左右输尿管交错蠕动',targets:ureters,duration:7,source:source.urine,description:'左右输尿管的收缩波以不同相位向膀胱方向推进，避免两侧机械地完全同步。',apply(p){ureters.forEach((e,i)=>tube(e,(p+i*.35)%1,{strength:.3}));explain('左右收缩波交错向下推进','每一侧都从独立的原始形态计算形变。',ureters);}});
  register({id:'urine-coupled',label:'输尿管推进与膀胱充盈',group:'器官联动',targets:unique([ureters,bladder]),duration:9,priority:90,source:source.urine,description:'输尿管局部收缩与膀胱缓慢充盈同时显示；粒子表示尿液向膀胱的输送方向，周期经过压缩。',apply(p){ureters.forEach((e,i)=>{tube(e,(p+i*.32)%1,{strength:.28});particle(e,p,{color:0xffdb79});});bladderShape(p);explain(p<.5?'输尿管推进 · 膀胱逐渐充盈':'输送继续 · 膀胱回到起始外形','输尿管和膀胱使用不同节律。');}});
 }
 if(bladder.length&&urethra.length)register({id:'micturition',label:'膀胱壁收缩与排尿通路',targets:unique([bladder,urethra]),duration:8,source:source.urine,description:'观察膀胱壁收缩，以及尿液沿尿道排出的方向。',apply(p){bladder.forEach(e=>soft(e,wave(p)*amp(),{shorten:.15,bulge:-.18,anchor:1}));urethra.forEach(e=>particle(e,p,{color:0xffda7c}));explain('膀胱壁缓慢收缩','沿尿道观察尿液排出的方向。',bladder);}});

 const diaphragm=match(/^(diaphragm|diaphragmatic fascia)$/),intercostal=match(/^(external|internal|innermost) intercostal muscles/),abdominal=match(/^rectus abdominis muscle|^(external|internal) abdominal oblique/);
 function diaphragmShape(p){
  const q=breath(p)*amp();
  for(const e of diaphragm){const b=e.motionBox,c=e.motionCenter;
   deform(e,v=>{const nx=(v.x-c.x)/Math.max(e.motionSize.x*.55,.0001),ny=(v.y-c.y)/Math.max(e.motionSize.y*.6,.0001),weight=Math.max(0,1-Math.min(1,nx*nx+ny*ny));v.z-=e.motionSize.z*.28*q*weight;});
   // A small common descent accompanies dome flattening.
   pose(e,c,V(1,0,0),0,[1,1,1],V(0,0,-e.motionSize.z*.025*q));
  }
 }
 if(diaphragm.length){
  enhance('diaphragm',{apply(p){diaphragmShape(p);explain(p<.4?'吸气 · 膈肌中央下降':'呼气 · 膈穹隆回升','中央穹隆的位移大于周边附着处。',diaphragm);},description:'膈肌中央穹隆下降并变平，周缘移动较小；呼气时平滑回升。'});
  register({id:'respiratory-muscles',label:'膈肌、肋间肌与腹壁联动',group:'器官联动',targets:unique([diaphragm,intercostal,abdominal]),duration:5,priority:92,source:source.breath,description:'膈穹隆下降时，肋间肌和腹壁随呼吸出现轻度外形变化。保留各组织的附着端，突出中央活动。',apply(p){diaphragmShape(p);intercostal.forEach(e=>soft(e,breath(p)*amp(),{shorten:.025,bulge:.045}));abdominal.forEach(e=>soft(e,breath(p)*amp(),{shorten:0,bulge:.05}));explain(p<.4?'吸气 · 膈肌下降、胸腹壁活动':'呼气 · 胸腹壁回位','不同肌群随同一呼吸周期联动。');}});
 }
 const muscles=entries.filter(e=>/肌/.test(e.motionCategory)&&/muscle|biceps|triceps|soleus|masseter|temporalis/.test(e.motionName));
 const limbMuscles=muscles.filter(e=>/biceps brachii|triceps brachii|rectus femoris|gastrocnemius/.test(e.motionName));
 if(limbMuscles.length)register({id:'muscle-belly',label:'肌腹收缩与肌腱端固定',group:'肌肉活动',targets:limbMuscles,duration:4,source:source.muscle,description:'肌腹中央缩短并增粗，靠近两端的形变逐渐减小，避免整块肌肉像刚体一样缩放。',apply(p){for(const e of limbMuscles)soft(e,wave(p)*amp(),{shorten:.12,bulge:.09,axis:field(e).axis});explain(p<.5?'肌腹收缩、中央增粗':'肌腹逐渐放松','两端的位移被平滑抑制。',limbMuscles);}});
 const eyeMuscles=match(/^palpebral part of orbicularis oculi|^levator palpebrae superioris/),chewers=match(/^(deep|superficial) part of masseter|^temporalis muscle/);
 if(eyeMuscles.length)register({id:'blink-muscles',label:'眨眼相关肌群交替活动',group:'肌肉活动',targets:eyeMuscles,duration:3.8,source:source.eye,description:'观察眼轮匝肌与上睑提肌在眨眼过程中的交替活动。',apply(p){const q=bump(p,.24,.31,.42)*amp();eyeMuscles.forEach(e=>soft(e,/orbicularis/.test(e.motionName)?q:-q*.45,{shorten:.1,bulge:.055,axis:field(e).axis}));explain('快速闭合阶段 · 较慢恢复阶段','对照闭眼与睁眼时的肌群变化。',eyeMuscles);}});
 if(chewers.length)register({id:'chewing-muscles',label:'咀嚼肌节律收缩',group:'肌肉活动',targets:chewers,duration:1.6,source:source.muscle,description:'咬肌和颞肌随咀嚼节律收缩和放松，左右侧相位略有错开。',apply(p){for(const e of chewers)soft(e,wave(p)*amp()*(e.motionName.endsWith('left')?1:.8),{shorten:.09,bulge:.075,axis:field(e).axis});explain(p<.5?'咀嚼肌收缩':'咀嚼肌舒张','肌腹中央活动比附着端明显。',chewers);}});

 // Hierarchical rigid chains: compose joint matrices about source-space pivots.
 function transform(pivot,axis,angle){const m=new THREE.Matrix4().makeRotationAxis(axis,angle);m.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(m)));return m;}
 function chainPose(arr,matrices){const local=new THREE.Matrix4();for(const m of matrices)local.multiply(m);const inverse=basis.clone().invert();for(const e of arr){pose(e,e.motionCenter);e.motion.matrix.copy(basis).multiply(local).multiply(inverse);e.motion.matrixWorldNeedsUpdate=true;}}
 const rigs=['left','right'].map(side=>({side,bones:sideBones(side),humerus:exact('humerus '+side),radius:exact('radius '+side),ulna:exact('ulna '+side),femur:exact('femur '+side),tibia:exact('tibia '+side)}));
 const armRigs=rigs.filter(r=>r.humerus&&r.radius&&r.ulna),legRigs=rigs.filter(r=>r.femur&&r.tibia);
 if(armRigs.length){
  const armTargets=armRigs.flatMap(r=>r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)));
  register({id:'forearm-rotation',label:'前臂旋前与旋后',group:'关节运动',side:true,targets:armTargets,source:source.joint,duration:5,description:'观察桡骨与手部围绕前臂长轴转动，完成旋前与回位。',apply(p){for(const r of armRigs){if(st().side!=='both'&&st().side!==r.side)continue;const pivot=endpoint(r.radius,true),axis=endpoint(r.ulna,false).sub(pivot).normalize();chainPose(r.bones.filter(e=>e===r.radius||isHand(e)),[transform(pivot,axis,wave(p)*1.1*amp()*(r.side==='left'?1:-1))]);}explain(p<.5?'桡骨与手部旋转':'回到起始位','比较固定的尺骨和移动的桡骨。');}});
  register({id:'wrist-deviation',label:'腕关节桡偏与尺偏',group:'关节运动',side:true,targets:armRigs.flatMap(r=>r.bones.filter(isHand)),source:source.joint,duration:5,description:'手部围绕腕部向桡侧和尺侧轻度摆动，前臂保持原位。',apply(p){for(const r of armRigs)if(st().side==='both'||st().side===r.side)chainPose(r.bones.filter(isHand),[transform(endpoint(r.radius,false),V(0,1,0),Math.sin(TAU*p)*.25*amp())]);explain('手部左右偏移','前臂位置保持稳定。');}});
  register({id:'shoulder-circle',label:'肩关节平滑环转',group:'关节运动',side:true,targets:armTargets,source:source.joint,duration:7,description:'将小幅前屈与外展平滑组合，远端前臂和手随上臂一起移动。',apply(p){for(const r of armRigs)if(st().side==='both'||st().side===r.side){const pivot=endpoint(r.humerus,true);chainPose(r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)),[transform(pivot,V(1,0,0),-.45*wave(p)*amp()),transform(pivot,V(0,1,0),.28*Math.sin(TAU*p)*amp())]);}explain('连续前屈与外展组合','保持同侧上肢作为相连骨链。');}});
 }
 if(legRigs.length){
  const legTargets=legRigs.flatMap(r=>r.bones.filter(e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e)));
  register({id:'ankle-plantarflexion',label:'踝关节跖屈与回位',group:'关节运动',side:true,targets:legRigs.flatMap(r=>r.bones.filter(isFoot)),source:source.joint,duration:4,description:'足部绕踝向下伸展，观察跖屈方向。',apply(p){for(const r of legRigs)if(st().side==='both'||st().side===r.side)chainPose(r.bones.filter(isFoot),[transform(endpoint(r.tibia,false),V(1,0,0),wave(p)*.45*amp())]);explain('足尖向下伸展并回位');}});
  register({id:'hip-circle',label:'髋关节小幅环转',group:'关节运动',side:true,targets:legTargets,source:source.joint,duration:7,description:'将小幅屈伸与外展组合成连续运动，保持大腿、小腿与足相连。',apply(p){for(const r of legRigs)if(st().side==='both'||st().side===r.side){const pivot=endpoint(r.femur,true);chainPose(r.bones.filter(e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e)),[transform(pivot,V(1,0,0),-.35*wave(p)*amp()),transform(pivot,V(0,1,0),.18*Math.sin(TAU*p)*amp())]);}explain('大腿带动小腿与足连续环转');}});
  register({id:'gait-cycle',label:'步行摆腿与对侧摆臂',group:'器官联动',side:true,targets:unique([legTargets,armRigs.flatMap(r=>r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)))]),source:source.joint,duration:2.4,priority:88,description:'髋、膝、踝协同运动，对侧上肢轻度摆动，呈现步态节律。',apply(p){
   for(const r of legRigs){if(st().side!=='both'&&st().side!==r.side)continue;const sign=r.side==='left'?1:-1,q=Math.sin(TAU*p)*sign*amp(),lift=Math.max(0,q);
    const hip=transform(endpoint(r.femur,true),V(1,0,0),-.35*q),knee=transform(endpoint(r.femur,false),V(1,0,0),.55*lift),ankle=transform(endpoint(r.tibia,false),V(1,0,0),-.15*lift);
    chainPose([r.femur], [hip]);chainPose(r.bones.filter(e=>/^(tibia|fibula|patella) /.test(e.motionName)),[hip,knee]);chainPose(r.bones.filter(isFoot),[hip,knee,ankle]);
   }
   for(const r of armRigs)if(st().side==='both'||st().side===r.side){const q=Math.sin(TAU*p)*(r.side==='left'?-1:1)*amp();chainPose(r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)),[transform(endpoint(r.humerus,true),V(1,0,0),-.2*q)]);}
   explain('左右腿交替 · 对侧上肢随动','髋部变换传递给膝和踝，避免小腿脱离大腿。');
  }});
 }
 for(const [id,label,body] of [['fingers-grasp','手指分节屈曲','hand'],['toes-curl','足趾分节屈曲','foot']]){
  const fingers=match(new RegExp('phalanx of .* (?:finger of '+body+(body==='foot'?'|toe':'')+')'));
  if(fingers.length)register({id,label,group:'关节运动',side:true,targets:fingers,source:source.joint,duration:5,description:'近节、中节和远节依次屈曲，远端骨节继承近端姿态，展示抓握或屈趾的骨链关系。',apply(p){
   for(const side of ['left','right'])for(const number of ['first','second','third','fourth','fifth']){
    if(st().side!=='both'&&st().side!==side)continue;
    const group=fingers.filter(e=>e.motionName.includes(number)&&e.motionName.endsWith(side)),proximal=group.find(e=>e.motionName.startsWith('proximal'));if(!proximal)continue;
    const q=wave(p)*amp(),base=transform(endpoint(proximal,true),V(1,0,0),-.6*q),mid=group.find(e=>e.motionName.startsWith('middle')),distal=group.find(e=>e.motionName.startsWith('distal'));
    chainPose([proximal],[base]);const bend=transform(endpoint(proximal,false),V(1,0,0),-.65*q);if(mid)chainPose([mid],[base,bend]);if(distal)chainPose([distal],[base,bend,...(mid?[transform(endpoint(mid,false),V(1,0,0),-.35*q)]:[])]);
   }explain(p<.5?'各节逐渐屈曲':'各节平滑伸展','远端随近端一起移动。');
  }});
 }
 const ribs=match(/(?:^| )rib (left|right)$|^costal cartilage/),sternum=match(/^body of sternum$|^manubrium$|^xiphoid process$/);
 if(ribs.length)register({id:'rib-breathing',label:'呼吸时肋骨与胸骨运动',group:'生理过程',targets:unique([ribs,sternum]),duration:5,source:source.breath,description:'肋骨围绕后端轻度抬升和外展，胸骨随之向前上方移动，展示胸廓扩张方向。',apply(p){const q=breath(p)*amp();for(const e of ribs){const pivot=e.motionCenter.clone();pivot.y=e.motionBox.max.y;pose(e,pivot,V(1,0,0),-.035*q,[1+.01*q,1,1]);}sternum.forEach(e=>pose(e,e.motionCenter,V(1,0,0),0,[1,1,1],V(0,-.003*q,.002*q)));explain(p<.4?'吸气 · 胸廓抬升与扩张':'呼气 · 胸廓回位','肋骨运动范围经过缩小以避免明显穿插。');}});
 const mandible=exact('mandible');
 if(mandible){const parts=unique([[mandible],match(/^lower .* (?:tooth|canine|premolar|incisor)(?: |$)/)]),pivot=mandible.motionCenter.clone();pivot.z=mandible.motionBox.max.z;pivot.y=mandible.motionBox.max.y;
  register({id:'jaw-chewing',label:'下颌旋转、前移与咀嚼',group:'关节运动',targets:parts,duration:2,source:source.joint,description:'在张口旋转之外叠加轻度前移和侧向偏移，形成平滑咀嚼轨迹。',apply(p){const q=wave(p)*amp();parts.forEach(e=>pose(e,pivot,V(1,0,0),.18*q,[1,1,1],V(.002*Math.sin(TAU*p)*amp(),-.003*q,0)));explain(p<.5?'张口并轻度前移':'闭口并回位');}});
 }

 const irises=match(/^iris (left|right)$/),lenses=match(/^lens (left|right)$/),eyes=match(/^(cornea|iris|lens|retina|sclera|vitreous|anterior chamber|posterior chamber|anterior segment|posterior segment|zonular fibres)/);
 function pupil(q){for(const e of irises){const c=e.motionCenter;deform(e,v=>{const radius=Math.hypot((v.x-c.x)/Math.max(e.motionSize.x/2,.0001),(v.z-c.z)/Math.max(e.motionSize.z/2,.0001)),f=1-.36*q*Math.max(0,1-Math.min(1,radius));v.x=c.x+(v.x-c.x)*f;v.z=c.z+(v.z-c.z)*f;});}}
 function eyeRotation(angleX,angleZ,converge=false){for(const side of ['left','right']){const ref=exact('sclera '+side)||exact('lens '+side);if(!ref)continue;chainPose(eyes.filter(e=>e.motionName.endsWith(side)),[transform(ref.motionCenter,V(0,0,1),angleZ*(converge?(side==='left'?1:-1):1)),transform(ref.motionCenter,V(1,0,0),angleX)]);}}
 if(eyes.length&&lenses.length){
  register({id:'near-response',label:'近反应：会聚、调节与缩瞳',group:'器官联动',targets:eyes,duration:6,priority:85,source:source.eye,description:'双眼向内会聚，晶状体变凸，瞳孔同时缩小；随后平滑回到看远状态。',apply(p){const q=wave(p)*amp();eyeRotation(0,.13*q,true);pupil(q);for(const e of lenses)soft(e,q,{shorten:-.2,bulge:-.025,axis:'y'});explain(p<.5?'看近 · 会聚、晶状体变凸、瞳孔缩小':'看远 · 三项变化逐渐恢复','双眼围绕各自眼球中心转动。',eyes);}});
  register({id:'eye-saccades',label:'双眼快速扫视与停留',group:'感觉器官',targets:eyes,duration:4,source:source.eye,description:'双眼快速切换注视方向，并在目标方向短暂停留，区别于匀速来回转动。',apply(p){let q=p<.2?smooth(p/.2):p<.45?1:p<.6?1-2*smooth((p-.45)/.15):p<.8?-1:-1+smooth((p-.8)/.2);eyeRotation(.03*wave(p)*amp(),q*.22*amp());explain('快速转向 · 短暂停留','眼球各组织绕同一个中心转动。',eyes);}});
  register({id:'eye-pursuit',label:'双眼平滑追踪',group:'感觉器官',targets:eyes,duration:7,source:source.eye,description:'双眼沿缓慢的水平与垂直组合轨迹追踪，保持各眼球内部结构同步。',apply(p){eyeRotation(.11*wave(p)*amp(),.22*Math.sin(TAU*p)*amp());explain('双眼连续追踪移动目标','水平和垂直运动平滑组合。',eyes);}});
 }
 const drums=match(/^tympanic membrane /),ossicles=match(/^(malleus|incus|stapes) /);
 if(drums.length){const oldHearing=modeMap.get('hearing-vibration')?.apply;
  register({id:'eardrum-wave',label:'鼓膜振型与听骨链传递',group:'感觉器官',targets:unique([drums,ossicles]),duration:2.4,source:source.eye,description:'鼓膜中央振幅较大、周缘较小，听小骨随之轻微运动。振动经过大幅降速与放大以便观察。',apply(p){oldHearing?.(p);for(const e of drums){const c=e.motionCenter,axis=['x','y','z'].reduce((a,b)=>e.motionSize[a]<e.motionSize[b]?a:b),keys=['x','y','z'].filter(k=>k!==axis);deform(e,v=>{const r=Math.hypot((v[keys[0]]-c[keys[0]])/Math.max(e.motionSize[keys[0]]*.5,.0001),(v[keys[1]]-c[keys[1]])/Math.max(e.motionSize[keys[1]]*.5,.0001));v[axis]+=Math.sin(TAU*p*3)*amp()*e.motionSize.length()*.025*Math.max(0,1-r*r);});}explain('鼓膜中央振动 · 听骨链跟随','鼓膜周缘的位移被抑制。',drums);}});
 }
 const tearDucts=match(/^nasolacrimal duct|^lacrimal canaliculus/);
 if(tearDucts.length)register({id:'tear-drainage',label:'泪液引流方向',group:'感觉器官',targets:tearDucts,duration:6,source:source.eye,kind:'流向粒子示意',description:'沿泪小管和鼻泪管，观察泪液的引流方向。',apply(p){tearDucts.forEach(e=>{particle(e,p,{color:0xa0e5f2});light([e],.15*wave(p));});explain('沿泪道观察引流方向','依次观察各段泪道。',tearDucts);}});
 const nerves=match(/^median nerve |^ulnar nerve |^sciatic nerve |^optic nerve /);
 if(nerves.length)register({id:'neural-impulses',label:'神经信号沿纤维传播',group:'生理过程',targets:nerves,duration:5,priority:80,source:source.nerve,kind:'信号传播示意',description:'发光粒子沿现有神经走行传播，表示信号传递的概念；神经本身保持原始形态。',apply(p){nerves.forEach(e=>{particle(e,p,{color:0xf7d772});light([e],.18*wave(p));});explain('信号沿神经走行传播','慢动作观察信号沿神经走行传播。',nerves);}});
 const deferens=match(/^ductus deferens /),ejaculatory=match(/^ejaculatory duct /);
 if(deferens.length)register({id:'deferens-wave',label:'输精管平滑肌推进波',group:'生理过程',targets:unique([deferens,ejaculatory]),duration:7,priority:80,source:source.male,description:'观察输精管平滑肌的推进性收缩，局部管径随收缩波依次改变。',apply(p){deferens.forEach(e=>tube(e,p,{strength:.2}));explain('输精管壁局部收缩向前推进','沿管壁观察收缩波。',deferens);}});
 const glands=match(/^thyroid gland$|^parathyroid gland|^suprarenal gland|^adenohypophysis$|^neurohypophysis$|^pineal gland$/);
 if(glands.length&&!arteries.length&&!stomach.length)register({id:'endocrine-signals',label:'内分泌信号释放',group:'生理过程',targets:glands,duration:7,priority:70,source:source.thyroid,kind:'信号粒子示意',description:'通过腺体周围的粒子，观察激素信号的释放。',apply(p){glands.forEach(e=>{particle(e,p,{color:0xe7b6fb,cloud:true});light([e],.12*wave(p));});explain('腺体释放信号 · 结构保持稳定','观察信号从腺体附近向外扩散。',glands);}});
 const nodes=match(/^(cervical|axillary|inguinal|submandibular|superficial inguinal).*nodes/);
 if(nodes.length)register({id:'immune-surveillance',label:'淋巴结内细胞巡行',group:'生理过程',targets:nodes.slice(0,16),duration:8,priority:70,source:source.lymph,kind:'细胞活动粒子示意',description:'通过局部移动的粒子，观察淋巴结内的免疫细胞巡行。',apply(p){nodes.slice(0,16).forEach(e=>{particle(e,p,{color:0xb6e4a4,cloud:true,count:10});light([e],.13*wave(p));});explain('局部巡行 · 淋巴结外形保持稳定','观察各组细胞的局部活动。');}});
 const skin=entries.filter(e=>/^skin$/.test(e.motionName)||e.motionCategory==='皮肤');
 if(skin.length)register({id:'surface-breathing',label:'体表胸腹呼吸起伏',group:'生理过程',targets:skin,duration:5,priority:65,source:source.breath,description:'在体表胸腹区域加入平滑的小幅呼吸起伏，四肢和头部保持稳定。使用身体比例定位胸腹范围。',apply(p){for(const e of skin){const c=e.motionCenter,b=e.motionBox,zspan=Math.max(e.motionSize.z,.0001);deform(e,v=>{const z=(v.z-b.min.z)/zspan,lateral=1-smooth((Math.abs(v.x-c.x)/Math.max(e.motionSize.x,.0001)-.18)/.12),w=smooth((z-.48)/.12)*(1-smooth((z-.78)/.1))*lateral*breath(p)*amp();v.x+=(v.x-c.x)*.012*w;v.y+=(v.y-c.y)*.028*w;});}explain(p<.4?'吸气 · 胸腹轮廓轻度扩张':'呼气 · 体表轮廓回位','只改变胸腹区域的外轮廓。',skin);}});
 return {preferred:motionModes.filter(m=>m.priority).sort((a,b)=>b.priority-a.priority)[0]?.id,
  resetFrame(){for(const fx of flows.values())fx.object.visible=false;}};
}

