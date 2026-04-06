import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileText, 
  Download, 
  X, 
  Loader2, 
  Plus, 
  CheckCircle2, 
  AlertCircle,
  Image as ImageIcon,
  Trash2,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { extractTextFromImage } from './lib/gemini';
import { cn } from './lib/utils';

interface CarouselSlide {
  id: string;
  file: File;
  preview: string;
  extractedText: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

export default function App() {
  const [slides, setSlides] = useState<CarouselSlide[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [postTitle, setPostTitle] = useState('youtube-carousel-post');
  const [isCapturing, setIsCapturing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCapture = async () => {
    if (!youtubeUrl) return;
    setIsCapturing(true);

    try {
      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Create a safe filename from the first few words of the post
      const safeTitle = data.text 
        ? data.text.slice(0, 50).replace(/[^a-z0-9]/gi, '-').toLowerCase() 
        : 'youtube-post';
      setPostTitle(safeTitle);

      const newSlides: CarouselSlide[] = data.images.map((imgUrl: string) => ({
        id: Math.random().toString(36).substring(7),
        file: new File([], 'youtube-image.jpg'), // Placeholder
        preview: `/api/proxy-image?url=${encodeURIComponent(imgUrl)}`,
        extractedText: data.text, // Use the post text for all slides initially
        status: 'completed', // Already have text and image
      }));

      setSlides((prev) => [...prev, ...newSlides]);
      setYoutubeUrl('');
    } catch (error) {
      console.error('Capture error:', error);
      alert('Failed to capture YouTube post. Make sure it is a public community post URL.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newSlides: CarouselSlide[] = files.map((file: File) => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
      extractedText: '',
      status: 'pending',
    }));

    setSlides((prev) => [...prev, ...newSlides]);
    if (postTitle === 'youtube-carousel-post') {
      setPostTitle(`uploaded-images-${new Date().getTime()}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeSlide = (id: string) => {
    setSlides((prev) => {
      const slide = prev.find((s) => s.id === id);
      if (slide) URL.revokeObjectURL(slide.preview);
      return prev.filter((s) => s.id !== id);
    });
  };

  const processSlide = async (id: string) => {
    const slide = slides.find((s) => s.id === id);
    if (!slide || slide.status === 'processing') return;

    setSlides((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'processing' } : s))
    );

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(slide.file);
      });

      const base64 = await base64Promise;
      const text = await extractTextFromImage(base64, slide.file.type);

      setSlides((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, extractedText: text, status: 'completed' } : s
        )
      );
    } catch (error) {
      console.error('Error processing slide:', error);
      setSlides((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'error' } : s))
      );
    }
  };

  const processAll = async () => {
    const pendingSlides = slides.filter((s) => s.status === 'pending' || s.status === 'error');
    for (const slide of pendingSlides) {
      await processSlide(slide.id);
    }
  };

  const generatePdf = async () => {
    if (slides.length === 0) return;
    setIsGeneratingPdf(true);

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      for (let i = 0; i < slides.length; i++) {
        if (i > 0) pdf.addPage();
        
        const slide = slides[i];
        
        // Add Title
        pdf.setFontSize(10);
        pdf.setTextColor(150);
        pdf.text(`Slide ${i + 1} of ${slides.length}`, margin, margin);
        
        // Add Image
        try {
          const img = new Image();
          img.src = slide.preview;
          await new Promise((resolve) => (img.onload = resolve));
          
          const imgRatio = img.height / img.width;
          const displayWidth = contentWidth;
          const displayHeight = displayWidth * imgRatio;
          
          // Ensure image doesn't take more than 60% of the page
          const maxHeight = pageHeight * 0.6;
          let finalWidth = displayWidth;
          let finalHeight = displayHeight;
          
          if (finalHeight > maxHeight) {
            finalHeight = maxHeight;
            finalWidth = finalHeight / imgRatio;
          }

          pdf.addImage(slide.preview, 'JPEG', margin + (contentWidth - finalWidth) / 2, margin + 10, finalWidth, finalHeight);
          
          // Add Extracted Text
          const textY = margin + 10 + finalHeight + 10;
          pdf.setFontSize(12);
          pdf.setTextColor(0);
          pdf.setFont('helvetica', 'normal');
          
          const splitText = pdf.splitTextToSize(slide.extractedText || 'No text extracted.', contentWidth);
          pdf.text(splitText, margin, textY);
        } catch (err) {
          console.error('Error adding image to PDF:', err);
          pdf.text('Error loading image for this slide.', margin, margin + 20);
        }
      }

      pdf.save(`${postTitle}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const updateText = (id: string, text: string) => {
    setSlides((prev) =>
      prev.map((s) => (s.id === id ? { ...s, extractedText: text } : s))
    );
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-red-100 selection:text-red-600">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-200">
              <FileText className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">YouTube Post to PDF</h1>
              <p className="text-xs text-neutral-500 font-medium">Transform community posts into documents</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {slides.length > 0 && (
              <button
                onClick={generatePdf}
                disabled={isGeneratingPdf || slides.some(s => s.status === 'processing')}
                className="flex items-center gap-2 bg-neutral-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isGeneratingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isGeneratingPdf ? 'Generating...' : 'Download PDF'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* URL Capture Section */}
        <div className="mb-12 bg-white p-8 rounded-3xl border border-neutral-200 shadow-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-red-600" />
            Capture Automatically
          </h2>
          <div className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="Paste YouTube Community Post URL (e.g., https://www.youtube.com/post/...)"
              className="flex-1 px-4 py-3 bg-neutral-50 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-200 transition-all"
            />
            <button
              onClick={handleCapture}
              disabled={isCapturing || !youtubeUrl}
              className="bg-neutral-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-neutral-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2 min-w-[160px]"
            >
              {isCapturing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              {isCapturing ? 'Capturing...' : 'Capture Post'}
            </button>
          </div>
          <p className="mt-3 text-xs text-neutral-400 font-medium">
            Note: This works for public community posts with images or carousels.
          </p>
        </div>

        {/* Filename Section */}
        {slides.length > 0 && (
          <div className="mb-8 bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <label className="text-sm font-bold text-neutral-500 uppercase whitespace-nowrap">
              PDF Filename:
            </label>
            <div className="flex-1 flex items-center gap-2 w-full">
              <input
                type="text"
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value.replace(/[^a-z0-9-_]/gi, '-').toLowerCase())}
                placeholder="Enter filename"
                className="flex-1 px-4 py-2 bg-neutral-50 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-200 transition-all text-sm"
              />
              <span className="text-sm font-bold text-neutral-400">.pdf</span>
            </div>
          </div>
        )}

        {slides.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-neutral-200 rounded-3xl bg-white"
          >
            <div className="w-20 h-20 bg-neutral-100 rounded-full flex items-center justify-center mb-6">
              <Upload className="text-neutral-400 w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Upload Carousel Slides</h2>
            <p className="text-neutral-500 mb-8 max-w-md text-center">
              Upload screenshots or images of the YouTube carousel slides. We'll extract the text and build your PDF.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-red-700 transition-all shadow-xl shadow-red-100 flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Select Images
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept="image/*"
              className="hidden"
            />
          </motion.div>
        ) : (
          <div className="space-y-8">
            {/* Actions Bar */}
            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm">
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold text-neutral-500 uppercase tracking-wider">
                  {slides.length} {slides.length === 1 ? 'Slide' : 'Slides'}
                </span>
                <div className="h-4 w-px bg-neutral-200" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add More
                </button>
              </div>
              
              <button
                onClick={processAll}
                disabled={slides.every(s => s.status === 'completed' || s.status === 'processing')}
                className="text-sm font-bold bg-neutral-100 text-neutral-900 px-4 py-2 rounded-lg hover:bg-neutral-200 transition-all disabled:opacity-50"
              >
                Process All with AI
              </button>
            </div>

            {/* Slides List */}
            <div className="grid grid-cols-1 gap-6">
              <AnimatePresence mode="popLayout">
                {slides.map((slide, index) => (
                  <motion.div
                    key={slide.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex flex-col md:flex-row">
                      {/* Image Preview */}
                      <div className="w-full md:w-1/3 aspect-square md:aspect-auto relative group">
                        <img 
                          src={slide.preview} 
                          alt={`Slide ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-md">
                          {index + 1} / {slides.length}
                        </div>
                        <button
                          onClick={() => removeSlide(slide.id)}
                          className="absolute top-4 right-4 bg-white/90 text-red-600 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Content Area */}
                      <div className="flex-1 p-6 flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            {slide.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                            {slide.status === 'processing' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
                            {slide.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                            {slide.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-neutral-200" />}
                            
                            <span className={cn(
                              "text-sm font-bold uppercase tracking-tight",
                              slide.status === 'completed' && "text-green-600",
                              slide.status === 'processing' && "text-blue-600",
                              slide.status === 'error' && "text-red-600",
                              slide.status === 'pending' && "text-neutral-400"
                            )}>
                              {slide.status === 'completed' ? 'AI Processed' : 
                               slide.status === 'processing' ? 'Extracting Text...' : 
                               slide.status === 'error' ? 'Extraction Failed' : 'Ready to Process'}
                            </span>
                          </div>

                          {slide.status !== 'completed' && slide.status !== 'processing' && (
                            <button
                              onClick={() => processSlide(slide.id)}
                              className="text-xs font-bold bg-neutral-900 text-white px-3 py-1.5 rounded-md hover:bg-neutral-800 transition-all"
                            >
                              Process Slide
                            </button>
                          )}
                        </div>

                        <div className="flex-1">
                          <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Extracted Content</label>
                          <textarea
                            value={slide.extractedText}
                            onChange={(e) => updateText(slide.id, e.target.value)}
                            placeholder={slide.status === 'processing' ? 'AI is reading the image...' : 'Extracted text will appear here...'}
                            className="w-full h-32 md:h-full p-4 bg-neutral-50 rounded-2xl border border-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-200 transition-all resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Hidden input for adding more files */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        accept="image/*"
        className="hidden"
      />

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-neutral-200">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-sm text-neutral-500">
            © 2026 YouTube Post to PDF. Powered by Gemini AI.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm font-bold text-neutral-400 hover:text-neutral-900 transition-colors">Privacy</a>
            <a href="#" className="text-sm font-bold text-neutral-400 hover:text-neutral-900 transition-colors">Terms</a>
            <a href="#" className="text-sm font-bold text-neutral-400 hover:text-neutral-900 transition-colors">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
