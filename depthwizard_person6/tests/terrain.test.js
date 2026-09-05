import assert from 'node:assert/strict'
import test from 'node:test'

import { loadTerrainData } from '../src/dataLoader.js'
import { createTerrain, sampleTerrain, setVerticalExaggeration } from '../src/terrain.js'

function jsonUrl(value) {
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`
}

test('a second mesh reduction preserves metric extent and original measurements', async () => {
  const data = {width: 9, height: 5, heights: Float32Array.from({length: 45}, (_, i) => i),
    min: 0, max: 44, units: 'metres', metadata: {pixelSizeX: 2, pixelSizeY: 3}}
  const {mesh, worldWidth, worldDepth} = await createTerrain(data, {maxGridSize: 3})
  assert.equal(worldWidth, 16)
  assert.equal(worldDepth, 12)
  assert.equal(sampleTerrain(mesh, 0, 0).elevation, 22)
  mesh.geometry.computeBoundingSphere()
  const radius = mesh.geometry.boundingSphere.radius
  setVerticalExaggeration(mesh, 5)
  assert.ok(mesh.geometry.boundingSphere.radius > radius)
  assert.equal(sampleTerrain(mesh, 0, 0).elevation, 22)
  mesh.geometry.dispose(); mesh.userData.colorMaterial.dispose()
})

test('null metadata does not become zero spacing or elevation', async () => {
  const terrain = await loadTerrainData({
    heightmapUrl: jsonUrl({width: 3, height: 2, heights: [4, 5, 6, 7, 8, 9], elevation_min: null, elevation_max: null}),
    metadataUrl: jsonUrl({pixel_size_x: null, pixel_size_y: null, target: {width: 9, height: 5}}),
  })
  assert.equal(terrain.min, 4); assert.equal(terrain.max, 9)
  assert.equal(terrain.metadata.pixelSizeX, 4); assert.equal(terrain.metadata.pixelSizeY, 4)
})

test('unreadable supplied metadata fails instead of relabelling calibrated heights', async () => {
  await assert.rejects(loadTerrainData({
    heightmapUrl: jsonUrl({width: 2, height: 2, heights: [100, 101, 102, 103]}),
    metadataUrl: 'data:application/json,invalid',
  }), /metadata is not valid JSON/)
})

test('masked finite outliers cannot contaminate filled geometry', async () => {
  const terrain = await loadTerrainData({heightmapUrl: jsonUrl({
    width: 2, height: 2, heights: [2, 999999, 2, 2], valid: [true, false, true, true],
  })})
  assert.deepEqual([...terrain.heights], [2, 2, 2, 2])
  assert.equal(terrain.validMask[1], 0)
})

test('fills a 512-square nodata region without argument overflow and retains its mask', async () => {
  const heights = Array(512 * 512).fill(null)
  heights[0] = 7
  const terrain = await loadTerrainData({heightmapUrl: jsonUrl({width: 512, height: 512, heights})})
  assert.equal(terrain.heights.at(-1), 7)
  assert.equal(terrain.validMask.at(-1), 0)
  assert.equal(terrain.units, 'relative')
})

test('loads heightmap JSON and preserves physical extent after downsampling', async () => {
  const terrain = await loadTerrainData({
    heightmapUrl: jsonUrl({ width: 3, height: 2, heights: [0, 1, 2, 3, 4, 5], units: 'metres' }),
    metadataUrl: jsonUrl({ target: { width: 9, height: 5, pixel_resolution: [2, 4] } }),
  })

  assert.equal(terrain.metadata.pixelSizeX, 8)
  assert.equal(terrain.metadata.pixelSizeY, 16)
  const created = await createTerrain(terrain)
  assert.equal(created.worldWidth, 16)
  assert.equal(created.worldDepth, 16)
  created.mesh.geometry.dispose()
  created.mesh.userData.colorMaterial.dispose()
})

test('converts EPSG:4326 degree pixels to local metre spacing', async () => {
  const terrain = await loadTerrainData({
    heightmapUrl: jsonUrl({ width: 3, height: 2, heights: [10, 11, 12, 13, 14, 15], units: 'metres' }),
    metadataUrl: jsonUrl({
      target: {
        crs: 'EPSG:4326', width: 3, height: 2,
        transform: [0.0001, 0, 77.1, 0, -0.0001, 28.65],
        pixel_resolution: [0.0001, 0.0001],
      },
    }),
  })

  assert.ok(terrain.metadata.pixelSizeX > 9 && terrain.metadata.pixelSizeX < 11)
  assert.ok(terrain.metadata.pixelSizeY > 10 && terrain.metadata.pixelSizeY < 12)
  const created = await createTerrain(terrain)
  assert.ok(created.worldWidth > 18)
  assert.ok(created.worldDepth > 10)
  created.mesh.geometry.dispose()
  created.mesh.userData.colorMaterial.dispose()
})

test('fills nodata and reports useful contract errors', async () => {
  const terrain = await loadTerrainData({
    heightmapUrl: jsonUrl({ width: 2, height: 2, heights: [1, null, 3, 4], units: 'relative' }),
  })
  assert.ok([...terrain.heights].every(Number.isFinite))
  assert.deepEqual([...terrain.validMask], [1, 0, 1, 1])

  await assert.rejects(
    loadTerrainData({ heightmapUrl: 'data:application/octet-stream,not-json' }),
    /height map is not valid JSON/i,
  )
})

test('removes triangles over invalid source pixels', async () => {
  const data = {
    width: 2,
    height: 2,
    heights: new Float32Array([1, 1, 1, 1]),
    validMask: new Uint8Array([0, 1, 1, 1]),
    min: 1,
    max: 1,
    units: 'relative',
    metadata: { pixelSizeX: 1, pixelSizeY: 1 },
    textureUrl: null,
  }
  const created = await createTerrain(data)
  assert.equal(created.mesh.geometry.index.count, 3)
  created.mesh.geometry.dispose()
  created.mesh.userData.colorMaterial.dispose()
})

test('samples elevations and applies vertical exaggeration consistently', async () => {
  const data = {
    width: 2,
    height: 2,
    heights: new Float32Array([10, 20, 30, 40]),
    min: 10,
    max: 40,
    units: 'metres',
    metadata: { pixelSizeX: 1, pixelSizeY: 1 },
    textureUrl: null,
  }
  const created = await createTerrain(data, { verticalExaggeration: 1 })
  assert.equal(sampleTerrain(created.mesh, 0, 0).elevation, 25)
  assert.equal(sampleTerrain(created.mesh, 0, 0).visualHeight, 15)
  setVerticalExaggeration(created.mesh, 2)
  assert.equal(sampleTerrain(created.mesh, 0, 0).visualHeight, 30)
  created.mesh.geometry.dispose()
  created.mesh.userData.colorMaterial.dispose()
})

test('smooths relative geometry without changing the measured height', async () => {
  const data = {
    width: 3,
    height: 3,
    heights: new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 0]),
    min: 0,
    max: 10,
    units: 'relative',
    metadata: { pixelSizeX: 1, pixelSizeY: 1 },
    textureUrl: null,
  }
  const created = await createTerrain(data, { verticalExaggeration: 1 })
  const point = sampleTerrain(created.mesh, 0, 0)
  assert.equal(point.elevation, 10)
  assert.ok(point.visualHeight > 0 && point.visualHeight <= 0.061)
  assert.ok(created.mesh.userData.sourceHeights[1] > 0)
  assert.equal(created.mesh.userData.elevationHeights[1], 0)
  assert.equal(point.gridX, 1)
  assert.equal(point.gridY, 1)
  assert.equal(point.slopeIsMetric, false)

  setVerticalExaggeration(created.mesh, 2)
  assert.equal(sampleTerrain(created.mesh, 0, 0).elevation, 10)
  created.mesh.geometry.dispose()
  created.mesh.userData.colorMaterial.dispose()
})
