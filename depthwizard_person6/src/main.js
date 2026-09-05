import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadTerrainData} from './dataLoader.js';
import {createTerrain,sampleTerrain,setTerrainMode,setVerticalExaggeration} from './terrain.js';
import {createCamera} from './camera.js';
import {createFirstPersonControls} from './firstPerson.js';
import {createFlythrough} from './flythrough.js';
import {createToolbar} from './controls.js';
import './styles.css';

function elevationLabel(value, units) {
  if (!Number.isFinite(value)) return '—';
  const relative = String(units || '').toLowerCase().startsWith('relative');
  return relative ? `${value.toFixed(3)} rel` : `${value.toFixed(1)} ${units || 'm'}`;
}

function calibrationLabel(metadata, relative) {
  if (relative) return 'Absolute elevation unavailable';
  const source=String(metadata?.calibration_source||metadata?.calibration_method||'Calibrated DSM');
  return source
    .replace('coarse SRTM heuristic','SRTM')
    .replace('GCPs','GCP')
    .replaceAll('_',' ');
}

function mapCoordinate(metadata, column, row) {
  const transform=metadata?.target?.transform||metadata?.transform;
  if(!Array.isArray(transform)||transform.length<6) return null;
  const [a,b,c,d,e,f]=transform.map(Number);
  if(![a,b,c,d,e,f,column,row].every(Number.isFinite)) return null;
  const x=a*(column+.5)+b*(row+.5)+c;
  const y=d*(column+.5)+e*(row+.5)+f;
  const crs=String(metadata?.target?.crs||metadata?.crs||'map');
  const geographic=/4326|CRS84/i.test(crs);
  return geographic ? `${x.toFixed(5)}, ${y.toFixed(5)}` : `${x.toFixed(2)}, ${y.toFixed(2)}`;
}

function setHelp(help,mode) {
  if(mode==='walk') help.innerHTML='<b>FREE FLIGHT</b><span>Click for mouse look · Esc releases · drag if unavailable · W/S forward · A/D strafe · Space/Q up · Shift/E down</span>';
  else if(mode==='fly') help.innerHTML='<b>AUTO FLY</b><span>Pause or switch to Overview / Walk at any time</span>';
  else help.innerHTML='<b>OVERVIEW</b><span>Drag to orbit · right-drag to pan · wheel to zoom</span>';
}

export async function createTerrainViewer({container,heightmapUrl,textureUrl,metadataUrl,apiBaseUrl='',verticalExaggeration=null}={}) {
  if(typeof container==='string') container=document.querySelector(container);
  if(!container) throw new Error('A valid viewer container is required.');
  container.classList.add('dw-viewer');
  const status=document.createElement('div');status.className='dw-status';status.textContent='Loading terrain…';container.append(status);
  let renderer,animationId,resizeObserver,firstPerson,orbit,terrain;
  try {
    const data=await loadTerrainData({heightmapUrl,textureUrl,metadataUrl,apiBaseUrl});
    const relativeUnits=String(data.units||'').toLowerCase().startsWith('relative');
    // A relative model has no physical vertical scale. Keep its relief control
    // deliberately modest; metric DSMs retain the wider analysis range.
    const maxExaggeration=relativeUnits ? 2 : 5;
    const requestedExaggeration=Number(verticalExaggeration);
    const defaultExaggeration=relativeUnits ? 1.4 : 1;
    verticalExaggeration=THREE.MathUtils.clamp(
      Number.isFinite(requestedExaggeration)&&requestedExaggeration>0
        ? requestedExaggeration
        : defaultExaggeration,
      .2,maxExaggeration,
    );
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=.92;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    terrain=await createTerrain(data,{
      verticalExaggeration,
      maxGridSize:512,
      maxAnisotropy:renderer.capabilities.getMaxAnisotropy(),
    });
    const span=Math.max(terrain.worldWidth,terrain.worldDepth,1);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x07131e);scene.fog=new THREE.FogExp2(0x07131e,.1/span);
    scene.add(terrain.mesh,new THREE.HemisphereLight(0xcce8ff,0x263428,.9));
    const sun=new THREE.DirectionalLight(0xfff2d6,1.35);sun.position.set(-.65*span,1.25*span,-.7*span);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-span*.65;sun.shadow.camera.right=span*.65;sun.shadow.camera.top=span*.65;sun.shadow.camera.bottom=-span*.65;sun.shadow.camera.near=span*.05;sun.shadow.camera.far=span*3;sun.shadow.bias=-.00008;sun.shadow.normalBias=span*.00008;scene.add(sun);
    const grid=new THREE.GridHelper(span*1.4,16,0x386070,0x17303b);grid.position.y=-.25;scene.add(grid);

    const {camera,home,target,eyeHeight,moveSpeed}=createCamera(
      terrain.worldWidth,terrain.worldDepth,terrain.maxRelief,
      {minimumEyeHeight:relativeUnits ? span*.025 : 1.7},
    );
    const initialGround=sampleTerrain(terrain.mesh,home.x,home.z).visualHeight;
    home.y=initialGround+eyeHeight;
    target.y=sampleTerrain(terrain.mesh,target.x,target.z).visualHeight+eyeHeight*.25;

    container.prepend(renderer.domElement);

    const rendererBadge=document.createElement('div');rendererBadge.className='dw-renderer-badge';
    const gl=renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName=debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const gpuLabel=gpuName.replace(/^ANGLE \(/,'').replace(/\)$/,'');
    const integrated=/Intel/i.test(gpuName),software=/SwiftShader|llvmpipe|software/i.test(gpuName);
    rendererBadge.textContent=`${software?'SOFTWARE':integrated?'INTEGRATED GPU':'GPU RENDER'} · ${gpuLabel}`;
    rendererBadge.classList.toggle('warning',integrated||software);
    rendererBadge.title=integrated
      ? `${gpuName} — run open_gpu_viewer.ps1 for Chromium's high-performance GPU preference.`
      : gpuName;
    container.append(rendererBadge);

    const elevationHud=document.createElement('div');elevationHud.className='dw-elevation';container.append(elevationHud);
    const help=document.createElement('div');help.className='dw-help';container.append(help);
    const crosshair=document.createElement('div');crosshair.className='dw-crosshair';crosshair.setAttribute('aria-hidden','true');crosshair.textContent='+';container.append(crosshair);

    let fly;
    firstPerson=createFirstPersonControls(camera,renderer.domElement,{
      width:terrain.worldWidth,
      depth:terrain.worldDepth,
      sampleGroundHeight:(x,z)=>sampleTerrain(terrain.mesh,x,z).visualHeight,
      eyeHeight:()=>eyeHeight,
      moveSpeed,
      onActivity:()=>{if(fly?.state!=='stopped')fly.stop()},
    });
    firstPerson.enabled=false;
    orbit=new OrbitControls(camera,renderer.domElement);
    orbit.enableDamping=true;
    orbit.dampingFactor=.075;
    orbit.minDistance=span*.08;
    orbit.maxDistance=span*4;
    orbit.maxPolarAngle=Math.PI*.485;
    orbit.screenSpacePanning=false;

    const overviewTarget=new THREE.Vector3(0,terrain.maxRelief*.12,0);
    const overviewPosition=new THREE.Vector3(-span*.62,Math.max(span*.68,terrain.maxRelief*2.4),span*.72);
    const showOverview=()=>{
      fly?.stop();
      firstPerson.enabled=false;
      orbit.enabled=true;
      camera.position.copy(overviewPosition);
      orbit.target.copy(overviewTarget);
      orbit.update();
      setHelp(help,'overview');
    };
    const showFirstPerson=()=>{
      fly?.stop();
      orbit.enabled=false;
      firstPerson.enabled=true;
      firstPerson.reset(home,target);
      setHelp(help,'walk');
    };

    fly=createFlythrough(camera,firstPerson,{width:terrain.worldWidth,depth:terrain.worldDepth,relief:terrain.maxRelief});
    const startFly=()=>{orbit.enabled=false;fly.start();setHelp(help,'fly')};
    const reset=showOverview;
    const toolbar=createToolbar(container,{
      onMode:mode=>setTerrainMode(terrain.mesh,mode),
      onExaggeration:value=>setVerticalExaggeration(terrain.mesh,value),
      onMoveSpeed:value=>firstPerson.setMoveSpeed(moveSpeed*value),
      onSensitivity:value=>firstPerson.setMouseSensitivity(value),
      onOverview:showOverview,
      onFirstPerson:showFirstPerson,
      onFly:startFly,
      onPause:()=>fly.pause(),
      onResume:()=>{fly.resume();if(fly.state==='playing'){orbit.enabled=false;setHelp(help,'fly')}},
      onReset:reset,
    },{initialExaggeration:verticalExaggeration,maxExaggeration});
    toolbar.setExaggeration(verticalExaggeration);
    showOverview();

    const raycaster=new THREE.Raycaster();
    const centerOfView=new THREE.Vector2(0,0);
    const targetWidth=Math.max(2,Number(data.metadata?.target?.width)||data.width);
    const targetHeight=Math.max(2,Number(data.metadata?.target?.height)||data.height);
    const sourceWidth=Math.max(2,Number(data.metadata?.target?.source_width)||targetWidth);
    const sourceHeight=Math.max(2,Number(data.metadata?.target?.source_height)||targetHeight);
    const units=data.units||'m';
    const calibration=calibrationLabel(data.metadata,relativeUnits);
    status.remove();
    const clock=new THREE.Clock();
    const render=()=>{
      animationId=requestAnimationFrame(render);
      const dt=Math.min(clock.getDelta(),.05);
      fly.update(dt);firstPerson.update(dt);if(orbit.enabled)orbit.update();

      raycaster.setFromCamera(centerOfView,camera);
      const hit=raycaster.intersectObject(terrain.mesh,false)[0];
      if(hit) {
        const point=sampleTerrain(terrain.mesh,hit.point.x,hit.point.z);
        const targetCol=point.gridX/(terrain.mesh.userData.width-1)*(targetWidth-1);
        const targetRow=point.gridY/(terrain.mesh.userData.height-1)*(targetHeight-1);
        const col=Math.round(targetCol/(targetWidth-1)*(sourceWidth-1));
        const row=Math.round(targetRow/(targetHeight-1)*(sourceHeight-1));
        const coordinate=mapCoordinate(data.metadata,targetCol,targetRow);
        const title=relativeUnits?'AIMED RELATIVE HEIGHT':'ESTIMATED ELEVATION';
        const slope=Number.isFinite(point.slopeDegrees) ? `${point.slopeDegrees.toFixed(1)}°${point.slopeIsMetric?'':' visual'}` : '—';
        elevationHud.innerHTML=`<strong>${title}</strong><span>VALUE <b>${elevationLabel(point.elevation,units)}</b></span><span>SLOPE <b>${slope}</b></span><span>PIXEL <b>r${row} · c${col}</b></span>${coordinate?`<span>COORD <b>${coordinate}</b></span>`:''}<span>SOURCE <b>${calibration}</b></span>`;
      } else {
        elevationHud.innerHTML=`<strong>${relativeUnits?'AIMED RELATIVE HEIGHT':'ESTIMATED ELEVATION'}</strong><span>VALUE <b>—</b></span><span>SLOPE <b>—</b></span><span>PIXEL <b>—</b></span><span>SOURCE <b>${calibration}</b></span>`;
      }
      renderer.render(scene,camera);
    };
    const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix()};
    resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);resize();render();
    return {
      scene,camera,renderer,terrain:terrain.mesh,controls:firstPerson,orbit,flythrough:fly,reset,
      destroy(){
        cancelAnimationFrame(animationId);resizeObserver.disconnect();firstPerson.destroy();orbit.dispose();
        terrain.mesh.geometry.dispose();
        terrain.mesh.userData.textureMaterial?.map?.dispose();terrain.mesh.userData.textureMaterial?.dispose();
        terrain.mesh.userData.colorMaterial?.dispose();renderer.dispose();container.replaceChildren();
      },
    };
  } catch(error) {
    if(animationId)cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();firstPerson?.destroy();orbit?.dispose();
    terrain?.mesh?.geometry?.dispose();
    terrain?.mesh?.userData?.textureMaterial?.map?.dispose();terrain?.mesh?.userData?.textureMaterial?.dispose();
    terrain?.mesh?.userData?.colorMaterial?.dispose();renderer?.dispose();
    status.classList.add('error');status.textContent=`Could not load terrain: ${error.message}`;throw error;
  }
}

if(document.querySelector('#terrain-viewer')) createTerrainViewer({container:'#terrain-viewer'});
