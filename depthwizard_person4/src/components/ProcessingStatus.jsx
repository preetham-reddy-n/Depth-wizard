const stages = {
  uploaded: 'Uploading source image',
  queued: 'Waiting for the processing worker',
  processing: 'Preparing analysis',
  preprocessing: 'Preprocessing image',
  depth_estimation: 'Estimating monocular depth',
  calibration: 'Calibrating elevation',
  terrain_generation: 'Preparing 3D terrain and metadata',
  completed: 'Terrain ready',
}

export default function ProcessingStatus({ status }) {
  return (
    <section className="processing-card" aria-live="polite">
      <div className="scanner"><span /><span /><span /></div>
      <div className="processing-copy">
        <span className="eyebrow">PIPELINE ACTIVE</span>
        <h2>Generating terrain…</h2>
        <p>{stages[status] || 'Processing scene data'}</p>
        <div className="progress-track indeterminate">
          <span />
        </div>
        <div className="progress-label"><span>{status?.replaceAll('_', ' ')}</span></div>
      </div>
    </section>
  )
}
