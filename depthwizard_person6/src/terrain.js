import * as THREE from 'three';

const ramp = [[0x102a43,0],[0x1f7a8c,.22],[0x65a30d,.45],[0xd6a84b,.68],[0x8b5e3c,.84],[0xf4f1e8,1]];
function colorAt(t) { for(let i=1;i<ramp.length;i++) if(t<=ramp[i][1]) { const [a,pa]=ramp[i-1],[b,pb]=ramp[i]; return new THREE.Color(a).lerp(new THREE.Color(b),(t-pa)/(pb-pa)); } return new THREE.Color(ramp.at(-1)[0]); }

async function loadTerrainTexture(url, maxAnisotropy=8) {
  // Result URLs are proxied through the frontend origin in development, so
  // the browser can safely upload the decoded image to WebGL.
  const texture=await new THREE.TextureLoader().loadAsync(url);
  // PlaneGeometry's top row uses v=1 after rotation. TextureLoader's standard
  // Y flip therefore keeps image pixel (column,row) aligned with DSM [row,col].
  texture.flipY=true;
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  texture.anisotropy=Math.max(1,Math.min(Number(maxAnisotropy)||8,16));
  return texture;
}

export async function createTerrain(data, { verticalExaggeration=1, maxGridSize=512, maxAnisotropy=8 }={}) {
  const sampled = resampleGrid(data, maxGridSize);
  const {width,height,heights,min,max} = sampled;
  const validMask=sampled.validMask||new Uint8Array(width*height).fill(1);
  const px = (Number(data.metadata.pixelSizeX)||1)*(data.width-1)/(width-1);
  const py = (Number(data.metadata.pixelSizeY)||Number(data.metadata.pixelSizeX)||1)*(data.height-1)/(height-1);
  const worldWidth=(width-1)*px, worldDepth=(height-1)*py;
  const worldSpan=Math.max(worldWidth,worldDepth,1);
  const relativeUnits=String(data.units||'').toLowerCase().startsWith('relative');
  // Monocular surfaces can contain extreme edge responses and fine ringing.
  // Clip only display geometry to robust limits, then run two conservative
  // low-pass passes. HUD values still come from the untouched source field.
  const [robustLow,robustHigh]=relativeUnits ? percentileBounds(heights,.01,.99) : [min,max];
  const clipped=relativeUnits ? clampGrid(heights,robustLow,robustHigh) : heights;
  const displayHeights=relativeUnits
    ? smoothGrid(smoothGrid(clipped,width,height,6),width,height,6)
    : heights;
  const [displayMin,displayMax]=finiteRange(displayHeights);
  const baseline=displayMin;
  const displayRange=Math.max(displayMax-displayMin,0);
  // Relative model output is unitless and otherwise looks almost flat against
  // a wide grid. A 3% default relief remains legible without turning coastlines
  // or illumination errors into the giant walls seen with the old 8% scale.
  const elevationScale=relativeUnits && displayRange>1e-8 ? worldSpan*.03/displayRange : 1;
  const geometry=new THREE.PlaneGeometry(worldWidth,worldDepth,width-1,height-1); geometry.rotateX(-Math.PI/2);
  const position=geometry.attributes.position, colors=new Float32Array(position.count*3);
  for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
    const i=row*width+col, normalized=THREE.MathUtils.clamp((heights[i]-robustLow)/Math.max(robustHigh-robustLow,1e-6),0,1);
    position.setY(i,(displayHeights[i]-baseline)*elevationScale*verticalExaggeration);
    const c=colorAt(normalized); colors.set([c.r,c.g,c.b],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  if(validMask.some(value=>!value)) {
    const kept=[];
    for(let row=0;row<height-1;row++) for(let col=0;col<width-1;col++) {
      const a=row*width+col,b=a+1,c=a+width,d=c+1;
      if(validMask[a]&&validMask[c]&&validMask[b]) kept.push(a,c,b);
      if(validMask[c]&&validMask[d]&&validMask[b]) kept.push(c,d,b);
    }
    geometry.setIndex(kept);
  }
  geometry.computeVertexNormals();
  const colorMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,metalness:0});
  let textureMaterial=null;
  if(data.textureUrl) try {
    const texture=await loadTerrainTexture(data.textureUrl,maxAnisotropy);
    // UV convention: height[row,col] maps to image pixel (col,row).
    textureMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:.96,metalness:0});
  } catch(error) { console.warn('Texture unavailable; using elevation colors.',error); }
  const mesh=new THREE.Mesh(geometry,textureMaterial||colorMaterial); mesh.receiveShadow=true; mesh.castShadow=true;
  mesh.userData={
    colorMaterial,textureMaterial,baseline,min,max,width,height,worldWidth,worldDepth,
    pixelSizeX:px,pixelSizeY:py,elevationScale,verticalExaggeration,relativeUnits,validMask,
    sourceHeights:Float32Array.from(displayHeights,v=>v-baseline),
    elevationHeights:Float32Array.from(heights),
  };
  return {mesh,worldWidth,worldDepth,maxRelief:displayRange*elevationScale*verticalExaggeration};
}

/** Sample the displayed surface and the original elevation field at X/Z. */
export function sampleTerrain(mesh, x, z) {
  const {
    width,height,worldWidth,worldDepth,sourceHeights,elevationHeights,
    elevationScale,verticalExaggeration,pixelSizeX,pixelSizeY,relativeUnits,
  }=mesh.userData;
  const gx=THREE.MathUtils.clamp((x/worldWidth+.5)*(width-1),0,width-1);
  const gz=THREE.MathUtils.clamp((z/worldDepth+.5)*(height-1),0,height-1);
  const displayed=sampleGrid(sourceHeights,width,height,gx,gz);
  const elevation=sampleGrid(elevationHeights,width,height,gx,gz);

  // Metric DSMs produce a physical slope. Relative outputs have no vertical
  // metric scale, so report the slope of the displayed surface and label it as
  // visual in the HUD rather than presenting it as a surveyed measurement.
  let riseX,riseZ;
  if(relativeUnits) {
    riseX=(sampleGrid(sourceHeights,width,height,gx+1,gz)-sampleGrid(sourceHeights,width,height,gx-1,gz))*elevationScale*verticalExaggeration/(2*pixelSizeX);
    riseZ=(sampleGrid(sourceHeights,width,height,gx,gz+1)-sampleGrid(sourceHeights,width,height,gx,gz-1))*elevationScale*verticalExaggeration/(2*pixelSizeY);
  } else {
    riseX=(sampleGrid(elevationHeights,width,height,gx+1,gz)-sampleGrid(elevationHeights,width,height,gx-1,gz))/(2*pixelSizeX);
    riseZ=(sampleGrid(elevationHeights,width,height,gx,gz+1)-sampleGrid(elevationHeights,width,height,gx,gz-1))/(2*pixelSizeY);
  }
  return {
    visualHeight:displayed*elevationScale*verticalExaggeration,
    elevation,
    gridX:gx,
    gridY:gz,
    slopeDegrees:THREE.MathUtils.radToDeg(Math.atan(Math.hypot(riseX,riseZ))),
    slopeIsMetric:!relativeUnits,
  };
}

export function setVerticalExaggeration(mesh, factor) {
  const p=mesh.geometry.attributes.position, original=mesh.userData.sourceHeights;
  if(original) for(let i=0;i<p.count;i++) p.setY(i,original[i]*mesh.userData.elevationScale*factor);
  else { const ratio=factor/mesh.userData.verticalExaggeration; for(let i=0;i<p.count;i++) p.setY(i,p.getY(i)*ratio); }
  mesh.userData.verticalExaggeration=factor; p.needsUpdate=true; mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
}

export function setTerrainMode(mesh, mode) {
  const {colorMaterial,textureMaterial}=mesh.userData;
  if(mode==='wireframe') { mesh.material=colorMaterial; colorMaterial.wireframe=true; }
  else { colorMaterial.wireframe=false; mesh.material=mode==='texture'&&textureMaterial ? textureMaterial : colorMaterial; }
}

function resampleGrid(data,maxSize) {
  const scale=Math.min(1,maxSize/Math.max(data.width,data.height)); if(scale===1) return data;
  const width=Math.max(2,Math.round(data.width*scale)), height=Math.max(2,Math.round(data.height*scale)), out=new Float32Array(width*height);
  const valid=data.validMask?new Uint8Array(width*height):null;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sourceX=x*(data.width-1)/(width-1),sourceY=y*(data.height-1)/(height-1);
    out[y*width+x]=sampleGrid(data.heights,data.width,data.height,sourceX,sourceY);
    if(valid) valid[y*width+x]=data.validMask[Math.round(sourceY)*data.width+Math.round(sourceX)];
  }
  return {...data,width,height,heights:out,validMask:valid};
}

function sampleGrid(values,width,height,x,y) {
  const gx=THREE.MathUtils.clamp(x,0,width-1),gy=THREE.MathUtils.clamp(y,0,height-1);
  const x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(x0+1,width-1),y1=Math.min(y0+1,height-1);
  const tx=gx-x0,ty=gy-y0;
  const a=values[y0*width+x0]*(1-tx)+values[y0*width+x1]*tx;
  const b=values[y1*width+x0]*(1-tx)+values[y1*width+x1]*tx;
  return a*(1-ty)+b*ty;
}

function smoothGrid(values,width,height,centerWeight=4) {
  const output=new Float32Array(values.length);
  for(let row=0;row<height;row++) for(let col=0;col<width;col++) {
    const center=values[row*width+col];
    let total=center*centerWeight,weight=centerWeight;
    if(col>0){total+=values[row*width+col-1];weight++;}
    if(col+1<width){total+=values[row*width+col+1];weight++;}
    if(row>0){total+=values[(row-1)*width+col];weight++;}
    if(row+1<height){total+=values[(row+1)*width+col];weight++;}
    output[row*width+col]=total/weight;
  }
  return output;
}

function finiteRange(values) {
  let low=Infinity,high=-Infinity;
  for(const value of values) if(Number.isFinite(value)){low=Math.min(low,value);high=Math.max(high,value);}
  return [low,high];
}

function percentileBounds(values,lowFraction,highFraction) {
  const sorted=Array.from(values,Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length) return [0,0];
  const quantile=fraction=>{
    const position=(sorted.length-1)*fraction,index=Math.floor(position),remainder=position-index;
    return sorted[index]+(sorted[Math.min(index+1,sorted.length-1)]-sorted[index])*remainder;
  };
  return [quantile(lowFraction),quantile(highFraction)];
}

function clampGrid(values,low,high) {
  return Float32Array.from(values,value=>THREE.MathUtils.clamp(value,low,high));
}
