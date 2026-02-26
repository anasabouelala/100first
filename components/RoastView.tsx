import React, { useState } from 'react';
import { RoastResult } from '../types';
import { roastLandingPage } from '../services/geminiService';
import { Upload, AlertTriangle, CheckCircle, Flame, Loader2, X } from 'lucide-react';

export const RoastView: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RoastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
      setResult(null);
      setError(null);
    }
  };

  const handleRoast = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const base64Data = preview.split(',')[1];
      const roastData = await roastLandingPage(base64Data);
      setResult(roastData);
    } catch (err) {
      setError("Failed to roast your page. Try a smaller image or a different format.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in pb-20">
      <div className="text-center">
        <h2 className="text-3xl font-display font-bold">Landing Page <span className="text-accent">Roast</span></h2>
        <p className="opacity-70 mt-2">Upload a screenshot. Get your feelings hurt. Increase conversion.</p>
      </div>

      <div className="card bg-base-100 border-2 border-dashed border-base-300 hover:border-primary transition-colors">
         <div className="card-body items-center text-center">
             {!preview ? (
                <div className="py-8 w-full">
                  <Upload size={48} className="mx-auto mb-4 opacity-50" />
                  <p className="font-bold mb-2">Upload Landing Page Screenshot</p>
                  <input 
                    type="file" 
                    className="file-input file-input-bordered file-input-primary w-full max-w-xs" 
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <p className="text-xs opacity-50 mt-2">PNG, JPG up to 5MB</p>
                </div>
             ) : (
                <div className="relative w-full">
                  <img src={preview} alt="Preview" className="w-full rounded-lg max-h-[400px] object-cover object-top opacity-80" />
                  <button 
                    onClick={() => { setPreview(null); setFile(null); setResult(null); }}
                    className="btn btn-circle btn-sm btn-error absolute top-2 right-2 text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
             )}
         </div>
      </div>

      {preview && !result && !loading && (
        <div className="flex justify-center">
          <button 
            onClick={handleRoast}
            className="btn btn-accent btn-lg gap-2 shadow-lg hover:scale-105 transition-transform text-white"
          >
            <Flame size={24} /> Roast My Page
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
           <span className="loading loading-ring loading-lg text-accent"></span>
           <p className="font-mono mt-4 opacity-70">Analyzing pixel data... Sharpening knives...</p>
        </div>
      )}

      {error && (
          <div className="alert alert-error text-white">
              <AlertTriangle />
              <span>{error}</span>
          </div>
      )}

      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Score Card */}
          <div className="stats shadow w-full bg-base-100 border border-base-200">
              <div className="stat place-items-center">
                <div className="stat-title">Conversion Score</div>
                <div className="stat-value text-primary">
                    <div className="radial-progress bg-base-100 border-4 border-base-100" style={{"--value":result.score, "--size": "6rem"} as any} role="progressbar">
                        {result.score}
                    </div>
                </div>
                <div className="stat-desc">Based on heuristics</div>
              </div>
          </div>

          {/* Roast Content */}
          <div className="card bg-base-100 border-l-4 border-error shadow-lg">
            <div className="card-body">
                <h3 className="card-title text-error flex items-center gap-2">
                  <AlertTriangle size={24} /> The Verdict
                </h3>
                <p className="text-lg italic opacity-90 leading-relaxed text-slate-700">"{result.roast}"</p>
            </div>
          </div>

          {/* Improvements */}
          <div className="card bg-base-100 shadow-lg border border-base-200">
             <div className="card-body">
                <h3 className="card-title text-success flex items-center gap-2 mb-4">
                  <CheckCircle size={24} /> Quick Wins
                </h3>
                <ul className="space-y-4">
                  {result.improvements.map((imp, i) => (
                    <li key={i} className="flex gap-4 items-start">
                      <div className="badge badge-success badge-lg text-white">{i + 1}</div>
                      <span className="text-base text-slate-800">{imp}</span>
                    </li>
                  ))}
                </ul>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};