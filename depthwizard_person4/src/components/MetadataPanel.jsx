function first(...values) { return values.find((value) => value !== undefined && value !== null && value !== '') }
function measurement(value, units) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(1)} ${units}` : null
}

export default function MetadataPanel({ data }) {
  const min = first(data.minimum_elevation, data.elevation_min, data.min_depth, data.depth?.min)
  const max = first(data.maximum_elevation, data.elevation_max, data.max_depth, data.depth?.max)
  const units = data.is_absolute_elevation === true ? 'm' : 'rel'
  const modelWidth = first(data.model_width, data.working_width, data.model_output_width)
  const modelHeight = first(data.model_height, data.working_height, data.model_output_height)
  const masked = Number(data.invalid_pixel_count)
  const stats = [
    ['Source grid', data.width && data.height ? `${data.width} × ${data.height}` : null],
    ['Inference grid', modelWidth && modelHeight ? `${modelWidth} × ${modelHeight}` : null],
    ['Georeferenced', typeof data.is_georeferenced === 'boolean' ? (data.is_georeferenced ? 'Yes' : 'No') : null],
    ['Minimum', measurement(min, units)],
    ['Maximum', measurement(max, units)],
    ['Mean', measurement(data.is_absolute_elevation === true ? data.mean_elevation : first(data.mean_elevation, data.mean_depth), units)],
    ['Elevation range', Number.isFinite(Number(min)) && Number.isFinite(Number(max)) ? `${(Number(max) - Number(min)).toFixed(1)} ${units}` : null],
    [data.crs ? 'CRS' : 'Declared CRS (rejected)', first(data.crs, data.target?.crs, data.declared_crs)],
    ['Calibration', first(data.calibration_method, data.calibration_source)],
    ['Pixel resolution (source CRS)', data.pixel_size_x != null && data.pixel_size_y != null ? `${data.pixel_size_x.toPrecision(5)} × ${data.pixel_size_y.toPrecision(5)} ${data.horizontal_units || 'CRS units'}` : null],
    ['NoData', data.nodata == null ? 'None declared / see validity mask' : String(data.nodata)],
    ['Depth model', first(data.depth_model, data.model)],
    ['ML compute', data.device ? String(data.device).toUpperCase() : null],
    ['Inference', data.tile_count > 1 ? `${data.tile_count} overlapping tiles` : null],
    ['Masked border', Number.isFinite(masked) && masked > 0 ? `${masked.toLocaleString()} model pixels` : null],
  ].filter(([, value]) => value !== null && value !== undefined)

  return (
    <section className="metadata-panel">
      <div className="section-heading compact"><div><span className="eyebrow">SCENE TELEMETRY</span><h2>Elevation summary</h2></div></div>
      {data.georeference_warning && <div className="metadata-warning"><strong>Georeferencing rejected</strong><span>{data.georeference_warning}</span></div>}
      {data.inferred_border_nodata && <div className="metadata-info"><strong>Scanned border masked</strong><span>Edge-connected film border and annotations were excluded from depth and 3D geometry.</span></div>}
      {stats.length ? <div className="stat-grid">{stats.map(([label, value]) => <div className="stat" key={label}><span>{label}</span><strong>{String(value)}</strong></div>)}</div> : <p className="muted">No additional metadata was supplied for this result.</p>}
      {data.transform && <details><summary>Geospatial grid metadata</summary><p>CRS: {data.crs}</p><p>Affine [a, b, c, d, e, f]: {data.transform.join(', ')}</p><p>Bounds: {JSON.stringify(data.bounds)}</p><p>Source dimensions: {data.width} × {data.height} pixels. Downloads retain the processing grid; the original upload is preserved.</p></details>}
      <p className="accuracy-note">{data.is_absolute_elevation === true ? 'Reference-calibrated estimated surface model — validate against independent elevation before operational use.' : 'Relative monocular estimate: higher values usually indicate surfaces closer to the aerial camera, but they are not measured metres or guaranteed semantic class heights.'}</p>
    </section>
  )
}
