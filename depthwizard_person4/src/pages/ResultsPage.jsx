import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ErrorMessage from '../components/ErrorMessage'
import MetadataPanel from '../components/MetadataPanel'
import ProcessingStatus from '../components/ProcessingStatus'
import { getJobResults, readableError, resolveApiUrl } from '../services/api'

const TerrainViewer = lazy(() => import('../components/TerrainViewer'))

function OutputCard({ eyebrow, title, url, fallback }) {
  return <article className="output-card"><div className="output-card-head"><div><span>{eyebrow}</span><h3>{title}</h3></div>{url && <a href={url} target="_blank" rel="noreferrer">Open ↗</a>}</div>{url ? <img src={url} alt={title} /> : <div className="output-empty">{fallback}</div>}</article>
}

export default function ResultsPage() {
  const { jobId } = useParams()
  const location = useLocation()
  const [results, setResults] = useState(location.state?.initialResults || null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    getJobResults(jobId)
      .then((data) => { if (active) setResults(data) })
      .catch((caught) => { if (active) setError(readableError(caught)) })
    return () => { active = false }
  }, [jobId])

  if (error) return <main className="page-width result-loading"><ErrorMessage message={error} /><Link className="secondary-button" to="/analyze">Back to upload</Link></main>
  if (!results) return <main className="page-width result-loading"><ProcessingStatus status="processing" /></main>

  const depthPreview = resolveApiUrl(results.depth_preview_url)
  const dsmPreview = resolveApiUrl(results.dsm_preview_url)
  const texture = resolveApiUrl(results.texture_url) || location.state?.originalPreview
  const heightmap = resolveApiUrl(results.heightmap_url || results.three_d_data_url)
  const dsm = resolveApiUrl(results.dsm_download_url)
  const metadata = resolveApiUrl(results.metadata_url)
  const isAbsolute = results.is_absolute_elevation === true

  return (
    <main className="page-width results-page">
      {results.warning && <p className="state-note" role="status">{results.warning}</p>}
      <p className="state-note">Estimated / fused surface from a single image; not survey-grade elevation. Object height above ground requires a separate ground reference.</p>
      <header className="result-header"><div><div className="success-label"><span>✓</span> ANALYSIS COMPLETE</div><h1>Terrain reconstruction</h1><p>Job <code>{jobId}</code> · {isAbsolute ? 'SRTM/GCP-calibrated elevation' : 'Relative elevation (not metres)'}</p></div><div className="result-actions"><Link className="secondary-button" to="/analyze">New analysis</Link>{dsm && <a className="primary-button" href={dsm} download>{isAbsolute ? 'Download DSM' : 'Download depth'} ↓</a>}</div></header>
      <section className="compare-grid"><OutputCard eyebrow="SOURCE / RGB" title="Original scene" url={texture} fallback="Original image unavailable." /><OutputCard eyebrow={isAbsolute ? 'OUTPUT / ELEVATION' : 'OUTPUT / RELATIVE HEIGHT'} title={isAbsolute ? 'DSM preview' : 'Relative height preview'} url={dsmPreview || depthPreview} fallback={isAbsolute ? 'DSM preview unavailable.' : 'Relative height preview unavailable.'} /></section>
      {isAbsolute && depthPreview && <details className="panel"><summary>View intermediate monocular depth (uncalibrated)</summary><OutputCard eyebrow="INTERMEDIATE / RELATIVE DEPTH" title="Monocular depth preview" url={depthPreview} /></details>}
      <section className="viewer-section"><div className="section-heading compact"><div><span className="eyebrow">INTERACTIVE OUTPUT</span><h2>3D terrain flythrough</h2></div><span className="status-pill">PERSON 6 MODULE</span></div><Suspense fallback={<div className="terrain-viewer"><div className="viewer-handoff"><span className="status-pill">LOADING 3D VIEWER</span><h3>Starting terrain renderer</h3></div></div>}><TerrainViewer heightmapUrl={heightmap} textureUrl={texture} metadataUrl={metadata} /></Suspense></section>
      <div className="results-lower"><MetadataPanel data={results} /><section className="downloads-panel"><span className="eyebrow">AVAILABLE FILES</span><h2>Export result</h2><div className="download-list">{dsm && <a href={dsm} download><span>{isAbsolute ? 'DSM' : 'Relative depth array'}</span><b>Download ↘</b></a>}{heightmap && <a href={heightmap} download><span>Heightmap</span><b>Download ↘</b></a>}{metadata && <a href={metadata} download><span>Metadata</span><b>Download ↘</b></a>}{!dsm && !heightmap && !metadata && <p className="muted">No downloadable files were exposed for this result.</p>}</div></section></div>
    </main>
  )
}
