/* Extracted from the supplied Bio2Mesh teaching-motion HTML. */
export function registerBaseMotions(api) {
 const {THREE,entries,state,basis,inverseBasis,scratch,match,exact,category,unique,both,boxOf,middle,source,add,pose,scaleParts,light,deform,tubeWave,explain,sequence,s}=api;
 const TAU=Math.PI*2,V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
 const wave=p=>(1-Math.cos(TAU*p))/2;
 const pulse=(p,a,b)=>p>a&&p<b?Math.sin(Math.PI*(p-a)/(b-a)):0;
 const chapter=slug=>'https://openstax.org/books/anatomy-and-physiology-2e/pages/'+slug;
 // Cardiac chambers are exact-name matches: nearby named vessels must not contract.
 const atria=both(/^(left|right) atrium$/),ventricles=both(/^(left|right) ventricle$/),valves=both(/leaflet/),papillary=both(/papillary muscle/);
 if(atria.length&&ventricles.length){
  const heart=unique([atria,ventricles,valves,papillary]);
  add({id:'heartbeat',label:'心脏搏动',targets:heart,source:source.heart,duration:1.6,description:'心房先收缩，随后心室收缩，再进入舒张充盈。',apply(p){
   const a=pulse(p,.04,.22),v=pulse(p,.24,.58),amp=state.amplitude;
   for(const e of atria)scaleParts([e],e.motionCenter,[1-.09*a*amp,1-.09*a*amp,1-.12*a*amp]);
   const c=middle(ventricles);scaleParts(unique([ventricles,papillary]),c,[1-.09*v*amp,1-.09*v*amp,1-.12*v*amp]);
   if(a>.1)light(atria,a*.35);if(v>.1)light(ventricles,v*.35);
   explain(p<.24?'心房收缩 · 心室充盈':p<.6?'心室收缩 · 射血阶段':'全心舒张 · 再次充盈','观察心房与心室的先后变化。',p<.24?atria:ventricles);
  }});
  sequence('valve-cycle','心脏瓣膜开闭时序',[
   s('房室瓣开放阶段',valves.filter(e=>/atrioventricular/.test(e.motionName)),'心室充盈时，房室瓣开放。'),
   s('半月瓣开放阶段',valves.filter(e=>/semilunar/.test(e.motionName)),'心室射血时，半月瓣开放。')],
   '瓣膜随心动周期开放与关闭，两侧压力差推动血液单向流动。',source.heart);
  sequence('pulmonary-circulation','肺循环路径',[
   s('右心室',both(/^right ventricle$/)),s('肺动脉',both(/pulmonary (trunk|artery)/)),s('肺静脉',both(/pulmonary vein/),'气体交换发生于肺毛细血管，血液随后经肺静脉回流。'),s('左心房',both(/^left atrium$/))],
   '沿右心室、肺动脉、肺静脉和左心房，观察肺循环的路径。',source.heart);
  sequence('systemic-circulation','体循环主要通路',[
   s('左心室',both(/^left ventricle$/)),s('主动脉',both(/^(ascending aorta|arch of aorta|thoracic aorta|abdominal aorta)$/)),s('腔静脉',both(/^(superior|inferior) vena cava$/),'静脉血汇入腔静脉，回到右心房。'),s('右心房',both(/^right atrium$/))],
   '从左心室射出的血液经主动脉进入体循环，回流最终汇入腔静脉和右心房。展示主要通路的先后关系。',source.heart);
 }
 // Respiratory lobes use a common pivot per lung, retaining contacts between lobes.
 const lobes=both(/lobe of (left|right) lung/);
 if(lobes.length){
  const lungs=['left','right'].map(side=>({parts:lobes.filter(e=>e.motionName.includes(side))})).filter(x=>x.parts.length);
  for(const lung of lungs){lung.box=boxOf(lung.parts);lung.pivot=lung.box.getCenter(V());lung.pivot.z=lung.box.max.z;}
  add({id:'breathing',label:'肺的吸气与呼气',targets:lobes,source:source.breath,duration:5,description:'吸气时胸腔扩大，肺随之扩张；呼气时肺回缩。两侧肺叶按同一侧的共同支点变化，便于观察体积变化。',apply(p){const q=wave(p)*state.amplitude;for(const lung of lungs)scaleParts(lung.parts,lung.pivot,[1+.055*q,1+.075*q,1+.065*q]);explain(p<.5?'吸气 · 肺容积增加':'呼气 · 肺逐渐回缩','观察吸气与呼气时的肺部轮廓。',lobes);}});
 }
 sequence('airway-route','空气进入肺的路径',[
  s('鼻腔与咽',both(/nasal mucosa|nasopharynx|oropharynx|laryngopharynx/)),s('气管',both(/^trachea$/)),s('主支气管',both(/^(left|right) main bronchus$/)),s('肺叶及肺段支气管',both(/lobar bronchus|segmental bronchus/)),s('肺叶',lobes)],
  '沿气道观察空气进入肺部的路径。',source.air);
 const epiglottis=exact('epiglottis');
 if(epiglottis){const pivot=epiglottis.motionCenter.clone();pivot.z=epiglottis.motionBox.min.z;
  add({id:'epiglottis',label:'吞咽时的会厌倾转',targets:[epiglottis],source:source.swallow,duration:4,description:'吞咽时，会厌倾转，配合喉部活动保护气道入口。',apply(p){pose(epiglottis,pivot,V(1,0,0),-.65*wave(p)*state.amplitude);explain(p<.5?'会厌向后倾转':'会厌回到起始位','观察会厌与喉入口的位置变化。',[epiglottis]);}});
 }
 const esophagus=both(/^(oesophagus|esophagus)$/);
 if(esophagus.length)add({id:'esophageal-wave',label:'食管蠕动',targets:esophagus,source:source.swallow,description:'收缩波沿食管向下推进，将食团送向胃。',apply(p){esophagus.forEach(e=>tubeWave(e,p));explain('收缩波向胃侧推进','观察局部管径变窄的位置随时间下移。',esophagus);}});
 const stomach=both(/^(stomach|mucosa of stomach)$/);
 if(stomach.length){const c=middle(stomach);
  add({id:'stomach-mixing',label:'胃壁节律收缩',targets:stomach,source:source.digest,description:'胃壁节律性收缩，帮助混合食物并逐步排空。',apply(p){const q=wave(p)*state.amplitude;scaleParts(stomach,c,[1+.045*q,1-.08*q,1-.045*q]);explain(p<.5?'胃壁收缩':'胃壁舒张','观察整体轮廓随节律变化。',stomach);}});
 }
 if(esophagus.length&&stomach.length)sequence('digestive-route','消化道推进顺序',[
  s('口腔起点',both(/^tongue$/)),s('食管',esophagus),s('胃',stomach),s('十二指肠',both(/^duodenum$/)),s('空肠',both(/^jejunum$/),'接下来观察结肠的形态与位置。'),s('结肠',both(/^(ascending|transverse|descending|sigmoid) colon$/))],
  '沿消化道依次观察各段结构及其连接关系。',source.digest);
 sequence('bile-route','胆汁进入肠道的通路',[
  s('肝',both(/^liver$/)),s('胆囊',both(/^gallbladder$/),'肝脏分泌胆汁，胆囊储存和浓缩胆汁。'),s('胆管',both(/^bile duct$/)),s('十二指肠',both(/^duodenum$/))],
   '胆汁由肝产生，可在胆囊储存，经胆道进入十二指肠。这里用结构高亮区分产生、储存和输送的环节。',chapter('23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder'));
 sequence('saliva-route','唾液腺与导管',[
  s('腮腺',both(/^parotid gland/)),s('腮腺管',both(/^parotid duct/)),s('下颌下腺',both(/^submandibular gland/)),s('下颌下腺管',both(/^submandibular duct/))],
  '分别观察腮腺和下颌下腺，沿各自导管认识唾液的分泌通路。',source.swallow);
 const ureters=both(/^ureter (left|right)$/),bladder=both(/^urinary bladder$/);
 if(ureters.length)add({id:'ureter-wave',label:'输尿管蠕动',targets:ureters,source:source.urine,description:'输尿管壁产生收缩波，将尿液从肾盂推向膀胱。',apply(p){ureters.forEach(e=>tubeWave(e,p,.35));explain('收缩波由上向下推进','左右输尿管同时演示，便于对照。',ureters);}});
 if(bladder.length){const b=boxOf(bladder),pivot=b.getCenter(V());pivot.z=b.min.z;
  add({id:'bladder-cycle',label:'膀胱充盈与排空',targets:bladder,source:source.urine,duration:8,description:'膀胱储尿时逐渐充盈，排尿后回缩。',apply(p){const q=wave(p)*state.amplitude;scaleParts(bladder,pivot,[1+.16*q,1+.16*q,1+.24*q]);explain(p<.5?'储尿 · 膀胱逐渐充盈':'排空 · 膀胱容积减小','可拖动进度停在任意阶段。',bladder);}});
 }
 sequence('urine-route','尿液排出通路',[
  s('肾',both(/^kidney (left|right)$/)),s('肾盂',both(/^renal pelvis/)),s('输尿管',ureters),s('膀胱',bladder),s('尿道',both(/^urethra$/))],
  '依次认识肾、肾盂、输尿管、膀胱和尿道，观察尿液形成后的运输通路。',source.urine);

 // Articulations use conservative rigid bone chains. Joint locations are atlas estimates.
 const bones=entries.filter(e=>e.motionCategory==='骨'||/^(humerus|radius|ulna|femur|patella|tibia|fibula|talus|calcaneus|mandible|atlas c1|axis c2)( |$)/.test(e.motionName));
 const isHand=e=>/finger of hand|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid bone|capitate|hamate/.test(e.motionName);
 const isFoot=e=>/toe|finger of foot|metatarsal|talus|calcaneus|navicular bone|cuneiform|cuboid/.test(e.motionName);
 const sideBones=side=>bones.filter(e=>new RegExp('\\b'+side+'\\b').test(e.motionName));
 function endpoint(e,upper){
  const b=e.motionBox,threshold=upper?b.max.z-e.motionSize.z*.085:b.min.z+e.motionSize.z*.085;let count=0;const sum=V();
  for(const m of e.meshes){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){scratch.fromBufferAttribute(p,i).applyMatrix4(inverseBasis);if(upper?scratch.z>=threshold:scratch.z<=threshold){sum.add(scratch);count++;}}}
  return count?sum.multiplyScalar(1/count):e.motionCenter.clone();
 }
 function joint(id,label,anchorName,anchorUpper,selector,degrees,axisName='x',sign=-1,detail=''){
  const rigs=[];
  for(const side of ['left','right']){const anchor=exact(anchorName+' '+side),chain=sideBones(side).filter(selector);if(!anchor||!chain.length)continue;
   const pivot=endpoint(anchor,anchorUpper),rig={side,anchor,pivot,chain};
   // Bind small connective tissues to the nearest moving bone, excluding axial tissues.
   const movingSet=new Set(chain),candidateBones=sideBones(side);
   const tissues=entries.filter(e=>/韧带|关节囊|软骨|纤维膜|髌下/.test(e.motionCategory)&&new RegExp('\\b'+side+'\\b').test(e.motionName));
   for(const e of tissues){let best=null,d=Infinity;for(const b of candidateBones){const dist=b.motionBox.distanceToPoint(e.motionCenter);if(dist<d){d=dist;best=b;}}if(movingSet.has(best)&&d<.045)rig.chain.push(e);}
   rigs.push(rig);
  }
  if(!rigs.length)return;
  add({id,label,group:'关节运动',side:true,targets:rigs.flatMap(x=>[x.anchor,...x.chain]),source:source.joint,duration:5,description:detail+' 观察关节两侧骨骼的联动。',apply(p){const q=wave(p)*state.amplitude;
   for(const rig of rigs){if(state.side!=='both'&&state.side!==rig.side)continue;const axis=V();axis[axisName]=1;const angle=degrees*Math.PI/180*q*(sign==='side'?(rig.side==='left'?-1:1):sign);rig.chain.forEach(e=>pose(e,rig.pivot,axis,angle));}
   explain(Math.abs(p-.5)<.03?'运动幅度最大处':p<.5?'向演示方向运动':'逐渐回到起始姿态','拖动进度、切换左右侧，可以对照远端骨链与近端支点。');
  }});
 }
 joint('shoulder-flexion','肩关节前屈','humerus',true,e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e),70,'x',-1,'上臂向前抬起，前臂和手随上臂一起移动。');
 joint('shoulder-abduction','肩关节外展','humerus',true,e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e),65,'y','side','上肢向身体两侧抬起，观察肩关节的外展方向。');
 joint('elbow-flexion','肘关节屈伸','humerus',false,e=>/^(radius|ulna) /.test(e.motionName)||isHand(e),100,'x',-1,'前臂绕肘部向前屈曲，肱骨保持原位。');
 joint('wrist-flexion','腕关节掌屈','radius',false,isHand,45,'x',-1,'手部向掌侧屈曲，前臂骨保持原位。');
 joint('hip-flexion','髋关节前屈','femur',true,e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e),55,'x',-1,'大腿向前抬起，小腿和足随之移动。');
 joint('hip-abduction','髋关节外展','femur',true,e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e),30,'y','side','下肢向身体外侧展开，观察髋部作为近端支点。');
 joint('knee-flexion','膝关节屈伸','femur',false,e=>/^(tibia|fibula) /.test(e.motionName)||isFoot(e),90,'x',1,'观察小腿向后屈曲，再逐渐伸直。');
 joint('ankle-dorsiflexion','踝关节背屈','tibia',false,isFoot,22,'x',-1,'足尖向小腿前侧抬起，认识踝关节背屈方向。');
 const atlas=exact('atlas c1'),mandible=exact('mandible');
 if(atlas&&bones.length){const pivot=atlas.motionCenter.clone(),head=unique([bones.filter(e=>(e===mandible||e.motionCenter.z>atlas.motionBox.max.z)&&!/atlas|axis/.test(e.motionName)),category('听小骨')]);const teeth=category('牙');
  for(const [id,label,axis,angle,description] of [['head-nod','头部点头',V(1,0,0),.2,'头部围绕上颈部轻度前屈与回位，认识点头方向。'],['head-turn','头部左右转动',V(0,0,1),.5,'头部围绕上颈部左右转动，认识旋转方向。']]){
   add({id,label,group:'关节运动',targets:unique([head,teeth,atlas]),source:source.joint,description:description+'',apply(p){const q=id==='head-turn'?Math.sin(TAU*p):wave(p);unique([head,teeth]).forEach(e=>pose(e,pivot,axis,angle*q*state.amplitude));explain(label,'观察头部朝向的变化。');}});
  }
 }
 if(mandible&&bones.length){const pivot=mandible.motionCenter.clone();pivot.y=mandible.motionBox.max.y; pivot.z=mandible.motionBox.max.z;const chain=unique([[mandible],both(/^lower (?:.* )?(?:tooth|canine|premolar|incisor)\b/)]);
  add({id:'jaw-opening',label:'下颌张口与闭口',group:'关节运动',targets:chain,source:source.joint,description:'观察下颌骨与下牙列在张口、闭口时的转动。',apply(p){chain.forEach(e=>pose(e,pivot,V(1,0,0),.26*wave(p)*state.amplitude));explain(p<.5?'逐渐张口':'逐渐闭口');}});
 }
 // Muscle shapes illustrate shortening and thickening, without inventing a force model.
 function musclePair(id,label,a,b,description){if(!a.length||!b.length)return;
  add({id,label,group:'肌肉活动',targets:unique([a,b]),source:source.muscle,description:description+' 观察肌腹交替缩短与舒张。',apply(p){const q=(p<.5?wave(p*2):0)*state.amplitude;
   for(const [arr,value] of [[a,q],[b,(p>.5?wave((p-.5)*2):0)*state.amplitude]])for(const e of arr){const z=1-.075*value,w=1/Math.sqrt(z);scaleParts([e],e.motionCenter,[w,w,z]);if(value>.1)light([e],value*.5);}
   explain(p<.5?'观察前一组肌肉':'观察拮抗肌群','肌腹缩短时，横径略增。',p<.5?a:b);
  }});
 }
 musclePair('elbow-muscles','肱二头肌与肱三头肌',both(/biceps brachii/),both(/triceps brachii/),'肱二头肌参与屈肘，肱三头肌参与伸肘。');
 musclePair('thigh-muscles','股前与股后肌群',both(/rectus femoris|vastus (lateralis|medialis|intermedius)/),both(/biceps femoris|semitendinosus|semimembranosus/),'股四头肌主要参与伸膝，股后肌群参与屈膝等动作。');
 musclePair('ankle-muscles','小腿前后肌群',both(/^tibialis anterior/),both(/gastrocnemius|^soleus /),'胫骨前肌参与背屈，腓肠肌与比目鱼肌参与跖屈。');
 const diaphragm=both(/^(diaphragm|diaphragmatic fascia)$/);
 if(diaphragm.length){const b=boxOf(diaphragm),pivot=b.getCenter(V());pivot.z=b.min.z;
  add({id:'diaphragm',label:'膈肌吸气运动',group:'肌肉活动',targets:diaphragm,source:source.breath,duration:5,description:'膈肌收缩时穹隆下降，增加胸腔容积；舒张时逐渐回升。',apply(p){scaleParts(diaphragm,pivot,[1,1,1-.28*wave(p)*state.amplitude]);explain(Math.abs(p-.5)<.03?'吸气末 · 膈穹隆处于低位':p<.5?'吸气 · 膈穹隆下降':'呼气 · 膈穹隆回升','观察穹隆高度的节律变化。',diaphragm);}});
 }
 // Eyes share one pivot per side; lens/iris deformations remain local to their own tissue.
 const lenses=both(/^lens (left|right)$/),irises=both(/^iris (left|right)$/);
 const eyeParts=entries.filter(e=>/^(cornea|iris|lens|retina|sclera|vitreous|anterior chamber|posterior chamber|anterior segment|posterior segment|zonular fibres)/.test(e.motionName));
 if(lenses.length&&eyeParts.length){const rigs=['left','right'].map(side=>{const parts=eyeParts.filter(e=>e.motionName.endsWith(side)),ref=exact('sclera '+side)||exact('lens '+side);return {parts,pivot:ref?.motionCenter};}).filter(x=>x.parts.length&&x.pivot);
  for(const [id,label,axis,angle] of [['eye-horizontal','双眼左右注视',V(0,0,1),.22],['eye-vertical','双眼上下转动',V(1,0,0),.18]])add({id,label,group:'感觉器官',targets:eyeParts,source:source.eye,description:'双眼协同转动，改变注视方向。',apply(p){for(const rig of rigs)rig.parts.forEach(e=>pose(e,rig.pivot,axis,Math.sin(TAU*p)*angle*state.amplitude));explain(label,'可暂停比较双眼朝向。',eyeParts);}});
  add({id:'lens-accommodation',label:'晶状体调节',group:'感觉器官',targets:lenses,source:source.eye,description:'看近物时晶状体变凸，屈光能力增加；看远物时相对变平。',apply(p){const q=wave(p)*state.amplitude;for(const e of lenses)scaleParts([e],e.motionCenter,[1-.025*q,1+.18*q,1-.025*q]);explain(p<.5?'近距离调节 · 晶状体变凸':'回到远距离状态','可先开启外层半透明，再放大查看晶状体。',lenses);}});
 }
 if(irises.length)add({id:'pupil-reflex',label:'瞳孔缩小与恢复',group:'感觉器官',targets:irises,source:source.eye,description:'虹膜内缘向瞳孔中心靠近，使瞳孔变小。主要改变内缘，示意瞳孔口径变化。',apply(p){const q=wave(p)*state.amplitude;
  for(const e of irises){const c=e.motionCenter,rx=e.motionSize.x/2,rz=e.motionSize.z/2;deform(e,v=>{const x=(v.x-c.x)/rx,z=(v.z-c.z)/rz,r=Math.hypot(x,z),f=1-.32*q*Math.max(0,1-Math.min(1,r));v.x=c.x+(v.x-c.x)*f;v.z=c.z+(v.z-c.z)*f;});}
  explain(p<.5?'虹膜内缘靠近 · 瞳孔缩小':'瞳孔逐渐恢复','通过虹膜开口观察口径变化。',irises);
 }});
 const ossicles=both(/^(malleus|incus|stapes) (left|right)$/),eardrums=both(/^(tympanic membrane|eardrum) /);
 if(ossicles.length&&eardrums.length)add({id:'hearing-vibration',label:'鼓膜与听小骨振动',group:'感觉器官',targets:unique([eardrums,ossicles]),source:source.eye,duration:2,description:'声振动经鼓膜和听小骨传向内耳，慢动作便于观察各部分的配合。',apply(p){const q=Math.sin(TAU*p)*state.amplitude;for(const e of unique([ossicles,eardrums]))pose(e,e.motionCenter,V(0,0,1),q*.015,[1,1,1],V((e.motionName.endsWith('left')?1:-1)*e.motionSize.length()*.015*q,0,0));explain('缓慢展示一个振动周期','观察鼓膜与听小骨的协同振动。',unique([eardrums,ossicles]));}});
 sequence('tear-route','泪液引流路径',[
  s('泪腺',both(/^lacrimal gland/)),s('泪小管',both(/lacrimal canalicul/)),s('泪囊',both(/^lacrimal sac/)),s('鼻泪管',both(/nasolacrimal duct/))],
  '泪腺分泌泪液润滑眼表，再经内眦附近的引流结构进入鼻泪管。',source.eye,'感觉器官');

 sequence('upper-limb-nerve','上肢神经分布顺序',[
  s('脊髓',both(/^(anterior horn|posterior horn|white matter) of spinal cord$/)),s('臂丛根与干',both(/roots of brachial plexus|^(superior|middle|inferior) trunk of brachial plexus/)),s('主要外周神经',both(/^(median|ulnar|radial) nerve (left|right)$/))],
  '从脊髓、臂丛到上肢主要神经，观察神经的分布关系。',chapter('13-4-the-peripheral-nervous-system'));
 sequence('spinal-horns','脊髓前后角功能对照',[
  s('后角',both(/^posterior horn of spinal cord$/),'后角参与处理传入的感觉信息。'),s('前角',both(/^anterior horn of spinal cord$/),'前角含有支配骨骼肌的躯体运动神经元。')],
  '对照脊髓后角与前角，认识感觉处理和躯体运动相关区域。',chapter('13-2-the-central-nervous-system'));
 sequence('lymph-regions','淋巴结区域巡览',[
  s('腹股沟区',both(/inguinal.*nodes|inguinal lymph/)),s('腹部与腰部',both(/lumbar.*nodes|aortic.*nodes/)),s('腋窝区',both(/axillary.*nodes/)),s('颈部',both(/cervical.*nodes/))],
  '分别观察颈部、腋窝、腹部及腹股沟的淋巴结分布。',source.lymph);
 sequence('immune-organs','免疫相关器官对照',[
  s('胸腺',both(/thymus/)),s('脾',both(/^spleen$/)),s('扁桃体',both(/tonsil/))],
  '轮流观察胸腺、脾和扁桃体的解剖位置，比较免疫相关器官在不同部位的分布。',source.lymph);
 sequence('thyroid-axis','垂体与甲状腺反馈',[
  s('腺垂体',both(/^adenohypophysis$/),'腺垂体分泌促甲状腺激素。'),s('甲状腺',both(/^thyroid gland$/),'甲状腺释放甲状腺激素。'),s('反馈至垂体',both(/^adenohypophysis$/),'甲状腺激素参与负反馈调节。')],
  '观察垂体与甲状腺之间的调节和反馈关系。',source.thyroid);
 sequence('endocrine-tour','主要内分泌腺巡览',[
  s('垂体',both(/^(adeno|neuro)hypophysis$/)),s('甲状腺与甲状旁腺',both(/thyroid gland|parathyroid gland/)),s('肾上腺',both(/^suprarenal gland/)),s('胰',both(/^pancreas$/)),s('睾丸',both(/^testis /))],
  '逐区观察主要内分泌腺，认识它们在身体中的位置。',chapter('17-1-an-overview-of-the-endocrine-system'));
 const deferens=both(/^ductus deferens /);
 if(deferens.length)sequence('sperm-route','精子运输相关结构',[
  s('睾丸',both(/^testis /)),s('附睾',both(/^epididymis /)),s('输精管',deferens),s('射精管',both(/^ejaculatory duct /))],
  '沿睾丸、附睾、输精管和射精管，观察运输相关结构。',source.male);
 sequence('male-glands','男性附属腺位置',[
  s('精囊',both(/^seminal gland /)),s('前列腺',both(/^prostate$/))],
  '对照精囊与前列腺，观察它们与运输通路的位置关系。',source.male);


 return {endpoint,sideBones,isHand,isFoot};
}

