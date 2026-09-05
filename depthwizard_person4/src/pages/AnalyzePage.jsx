import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorMessage from '../components/ErrorMessage'
import ImagePreview from '../components/ImagePreview'
import ProcessingStatus from '../components/ProcessingStatus'
import UploadZone from '../components/UploadZone'
import { createJob, getJobStatus, MAX_UPLOAD_SIZE_MB, POLL_INTERVAL_MS, readableError } from '../services/api'

const allowed = ['png', 'jpg', 'jpeg', 'tif', 'tiff']

export default function AnalyzePage() {
  const navigate = useNavigate()
  const timerRef = useRef(null)
  const pollFailuresRef = useRef(0)
  const requestGeneration = useRef(0)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [validationError, setValidationError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advanced, setAdvanced] = useState({ gcp: null, srtm: null })
  const [processing, setProcessing] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => () => { requestGeneration.current += 1; clearTimeout(timerRef.current) }, [])

  function chooseFile(next) {
    setValidationError('')
    const extension = next.name.split('.').pop()?.toLowerCase()
    if (!allowed.includes(extension)) return setValidationError('Unsupported file type. Choose PNG, JPEG, or TIFF.')
    if (next.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) return setValidationError(`File is too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(next)
    setPreviewUrl(URL.createObjectURL(next))
  }

  function reset() {
    requestGeneration.current += 1
    clearTimeout(timerRef.current)
    setProcessing(null)
    setError('')
  }

  async function poll(jobId, generation) {
    if (generation !== requestGeneration.current) return
    try {
      const state = await getJobStatus(jobId)
      if (generation !== requestGeneration.current) return
      pollFailuresRef.current = 0
      setProcessing(state)
      if (state.status === 'completed') return navigate(`/results/${jobId}`)
      if (state.status === 'failed') {
        setError(state.message || 'The processing pipeline failed.')
        setProcessing(null)
        return undefined
      }
      timerRef.current = setTimeout(() => poll(jobId, generation), POLL_INTERVAL_MS)
    } catch (caught) {
      if (generation !== requestGeneration.current) return
      if (pollFailuresRef.current < 3) {
        pollFailuresRef.current += 1
        timerRef.current = setTimeout(() => poll(jobId, generation), POLL_INTERVAL_MS * pollFailuresRef.current)
        return
      }
      setError(readableError(caught))
      setProcessing(null)
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (!file) return setValidationError('Please select an image.')
    const extension = file.name.split('.').pop()?.toLowerCase()
    if ((advanced.gcp || advanced.srtm) && !['tif', 'tiff'].includes(extension)) {
      return setValidationError('Elevation calibration files require a georeferenced GeoTIFF source.')
    }
    setError('')
    setValidationError('')
    pollFailuresRef.current = 0
    setProcessing({ status: 'uploaded' })
    const generation = ++requestGeneration.current
    try {
      const response = await createJob(file, advanced)
      if (generation !== requestGeneration.current) return
      if (!response.job_id) throw new Error('The backend response did not include a job ID.')
      if (response.status === 'completed') return navigate(`/results/${response.job_id}`, { state: { initialResults: response } })
      setProcessing(response)
      return poll(response.job_id, generation)
    } catch (caught) {
      if (generation !== requestGeneration.current) return
      setError(readableError(caught))
      setProcessing(null)
    }
  }

  if (processing) return <main className="page-width analysis-state"><ProcessingStatus status={processing.status} progress={processing.progress} /><p className="state-note">Keep this page open while DepthWizard works through the scene.</p></main>

  return (
    <main className="page-width analyze-page">
      <div className="page-intro"><span className="eyebrow">NEW ANALYSIS</span><h1>Build terrain from a single view.</h1><p>Choose an overhead or oblique RGB image. GeoTIFFs retain spatial context when the backend pipeline supports it.</p></div>
      {error && <ErrorMessage message={error} onRetry={reset} />}
      <form className="analysis-grid" onSubmit={submit}>
        <section className="upload-panel panel"><div className="panel-title"><span>01</span><div><h2>Source image</h2><p>Select the scene to reconstruct.</p></div></div><UploadZone file={file} onFile={chooseFile} error={validationError} />
          <button className="advanced-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}><span>Advanced / geospatial options</span><b>{advancedOpen ? '−' : '+'}</b></button>
          {advancedOpen && <div className="advanced-options"><label>GCP data <input type="file" accept=".csv,.json" onChange={(event) => setAdvanced({ ...advanced, gcp: event.target.files?.[0] })} /><small>CSV/JSON: row,col,elevation_m in source pixels, or WGS84 longitude,latitude,elevation_m.</small></label><label>SRTM elevation data <input type="file" accept=".tif,.tiff,.hgt" onChange={(event) => setAdvanced({ ...advanced, srtm: event.target.files?.[0] })} /><small>Local georeferenced DEM GeoTIFF, or a correctly named tile such as N28E077.hgt.</small></label></div>}
        </section>
        <section className="preview-panel panel"><div className="panel-title"><span>02</span><div><h2>Scene preview</h2><p>Confirm the selected source.</p></div></div><ImagePreview url={previewUrl} file={file} onRemove={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setFile(null) }} /><button className="primary-button generate-button" type="submit" disabled={!file}>Generate 3D terrain <span>→</span></button><p className="button-note">Depth estimation may take several minutes on CPU.</p></section>
      </form>
    </main>
  )
}
