function finite(value, fallback) { if (value == null || value === '') return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function horizontalSampleSpacing(metadata, pixelResolution) {
  const crs = String(metadata?.target?.crs || metadata?.crs || '');
  const transform = metadata?.target?.transform || metadata?.transform;
  const geographic = /EPSG\s*:\s*4326|CRS\s*:?\s*84/i.test(crs);
  if (geographic) {
    // Geographic affine coefficients are degrees, not metres. Convert both
    // possibly rotated pixel-axis vectors at the scene centre to a local metric
    // approximation suitable for terrain aspect and slope calculations.
    let latitude = 0;
    if (Array.isArray(transform) && transform.length >= 6) {
      const [a, b, c, d, e, f] = transform.map(Number);
      const width = finite(metadata?.target?.width, 1);
      const height = finite(metadata?.target?.height, 1);
      latitude = d * width / 2 + e * height / 2 + f;
      const metresPerLongitudeDegree = 111320 * Math.max(Math.cos(latitude * Math.PI / 180), 1e-6);
      const metresPerLatitudeDegree = 110574;
      return [
        Math.hypot(a * metresPerLongitudeDegree, d * metresPerLatitudeDegree),
        Math.hypot(b * metresPerLongitudeDegree, e * metresPerLatitudeDegree),
      ];
    }
    const metresPerLongitudeDegree = 111320;
    return [Math.abs(pixelResolution[0]) * metresPerLongitudeDegree, Math.abs(pixelResolution[1]) * 110574];
  }
  const unitToMetre = Math.abs(finite(
    metadata?.target?.horizontal_unit_to_metre ?? metadata?.horizontal_unit_to_metre,
    1,
  )) || 1;
  return [Math.abs(pixelResolution[0]) * unitToMetre, Math.abs(pixelResolution[1]) * unitToMetre];
}

function finiteRange(values) {
  let min = Infinity, max = -Infinity;
  for (const value of values) if (Number.isFinite(value)) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

export async function loadTerrainData({ heightmapUrl, textureUrl, metadataUrl, apiBaseUrl = '' } = {}) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const resolve = (url, fallback) => url || (base ? `${base}/${fallback}` : null);
  const heightUrl = resolve(heightmapUrl, 'heightmap.json');
  if (!heightUrl) return createProceduralTerrain();
  const [heightResponse, metadataResponse] = await Promise.all([
    fetch(heightUrl),
    metadataUrl ? fetch(metadataUrl) : Promise.resolve(null),
  ]);
  if (!heightResponse.ok) throw new Error(`Height map request failed (${heightResponse.status})`);
  let raw;
  try { raw = await heightResponse.json(); }
  catch { throw new Error('Height map is not valid JSON. The API must return heightmap.json, not a raw NPY/TIFF array.'); }
  let metadata = {};
  if (metadataResponse) {
    if (!metadataResponse.ok) throw new Error(`Terrain metadata request failed (${metadataResponse.status}). Retry to load correct units and scale.`);
    try { metadata = await metadataResponse.json(); }
    catch { throw new Error('Terrain metadata is not valid JSON. Cannot determine units and scale.'); }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid terrain metadata: expected an object.');
  const width = Math.floor(finite(raw.width, 0));
  const height = Math.floor(finite(raw.height, 0));
  if (width < 2 || height < 2 || !Array.isArray(raw.heights) || raw.heights.length !== width * height) {
    throw new Error('Invalid heightmap JSON: expected width × height flattened samples.');
  }
  const nodata = raw.nodata ?? metadata.nodata;
  const values = raw.heights.map((v) => {
    if (v === null || v === undefined) return NaN;
    const n = Number(v); return Number.isFinite(n) && n !== nodata ? n : NaN;
  });
  const validMask = Array.isArray(raw.valid) && raw.valid.length === values.length
    ? Uint8Array.from(raw.valid, (value, index) => Boolean(value) && Number.isFinite(values[index]))
    : Uint8Array.from(values, (value) => Number.isFinite(value));
  for (let i = 0; i < values.length; i++) if (!validMask[i]) values[i] = NaN;
  fillMissing(values, width, height);
  const range = finiteRange(values);
  const min = finite(raw.elevation_min, range.min);
  const max = finite(raw.elevation_max, range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new Error('Invalid heightmap JSON: elevation range is not finite.');
  }
  const pixelResolution = metadata?.target?.pixel_resolution;
  const sourceWidth = Math.floor(finite(metadata?.target?.width, width));
  const sourceHeight = Math.floor(finite(metadata?.target?.height, height));
  const sampleScaleX = sourceWidth > 1 ? (sourceWidth - 1) / (width - 1) : 1;
  const sampleScaleY = sourceHeight > 1 ? (sourceHeight - 1) / (height - 1) : 1;
  const rawPixelX = Array.isArray(pixelResolution)
    ? Math.abs(finite(pixelResolution[0], 1))
    : Math.abs(finite(metadata.pixel_size_x, 1));
  const rawPixelY = Array.isArray(pixelResolution)
    ? Math.abs(finite(pixelResolution[1], rawPixelX))
    : Math.abs(finite(metadata.pixel_size_y, rawPixelX));
  const [sourcePixelX, sourcePixelY] = horizontalSampleSpacing(metadata, [rawPixelX, rawPixelY]);
  metadata.pixelSizeX = Math.abs(finite(metadata.pixelSizeX, sourcePixelX * sampleScaleX)) || 1;
  metadata.pixelSizeY = Math.abs(finite(metadata.pixelSizeY, sourcePixelY * sampleScaleY)) || metadata.pixelSizeX;
  return { width, height, heights: new Float32Array(values), validMask, min, max, units: metadata.is_absolute_elevation === true ? (metadata.elevation_units || 'metres') : 'relative', metadata, textureUrl: resolve(textureUrl, 'texture.png') };
}

// Deterministic nearest-neighbour spreading prevents nodata holes without inventing spikes.
function fillMissing(values, width, height) {
  const queue = new Int32Array(values.length);
  let head = 0, tail = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) queue[tail++] = i;
  if (!tail) throw new Error('Height map contains no valid elevation samples.');
  const visit = (index, source) => {
    if (!Number.isFinite(values[index])) {
      values[index] = values[source];
      queue[tail++] = index;
    }
  };
  while (head < tail) {
    const i = queue[head++], x = i % width;
    if (x) visit(i - 1, i);
    if (x + 1 < width) visit(i + 1, i);
    if (i >= width) visit(i - width, i);
    if (i + width < values.length) visit(i + width, i);
  }
}

export function createProceduralTerrain(width = 160, height = 112) {
  const values = new Float32Array(width * height); let min = Infinity, max = -Infinity;
  for (let row=0; row<height; row++) for (let col=0; col<width; col++) {
    const x=(col/(width-1)-.5)*5, z=(row/(height-1)-.5)*4;
    const v=42*Math.exp(-(x*x+z*z)*.42)+18*Math.sin(x*2.1)*Math.cos(z*1.7)+32*Math.exp(-((x-1.2)**2+(z+.8)**2)*2);
    values[row*width+col]=v; min=Math.min(min,v); max=Math.max(max,v);
  }
  return { width,height,heights:values,min,max,units:'relative',metadata:{pixelSizeX:1,pixelSizeY:1,name:'Procedural demo'},textureUrl:null };
}
