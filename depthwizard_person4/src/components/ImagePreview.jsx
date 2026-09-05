export default function ImagePreview({ url, file, onRemove }) {
  if (!url) {
    return <div className="preview-empty"><span>NO SOURCE</span><p>Your selected scene will appear here.</p></div>
  }
  return (
    <div className="image-preview">
      {/\.tiff?$/i.test(file.name)
        ? <div className="preview-empty"><span>TIFF SOURCE</span><p>RGB preview and geospatial metadata will appear after preprocessing. The original raster is preserved.</p></div>
        : <img src={url} alt={`Preview of ${file.name}`} />}
      <div className="image-meta">
        <div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
        <button type="button" onClick={onRemove}>Remove</button>
      </div>
    </div>
  )
}
