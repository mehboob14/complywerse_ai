'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';

interface Screenshot {
  src: string;
  title: string;
  description: string;
}

const screenshots: Screenshot[] = [
  {
    src: '/screenshots/dashboard.png',
    title: 'Unified Dashboard',
    description: 'Get a complete view of your compliance posture with real-time metrics, risk indicators, and progress tracking across all frameworks.',
  },
  {
    src: '/screenshots/control-library.png',
    title: 'AI-Powered Control Library',
    description: 'Automatically map controls across 11+ regulatory frameworks. Our AI identifies overlaps and gaps, eliminating redundant compliance work.',
  },
  {
    src: '/screenshots/frameworks.png',
    title: 'Multi-Framework Management',
    description: 'Manage SAMA, PCI-DSS, GDPR, NIST CSF, SWIFT, and more from a single interface. Track compliance status for each framework independently.',
  },
  {
    src: '/screenshots/risk-management.png',
    title: 'Enterprise Risk Management',
    description: 'Comprehensive risk register with heat maps, KRIs, RCSA campaigns, and mitigation tracking. Make informed decisions with real-time risk visibility.',
  },
  {
    src: '/screenshots/evidence.png',
    title: 'Evidence Management',
    description: 'Streamline evidence collection with AI-powered quality assessment, version control, and automatic linking to controls and frameworks.',
  },
];

export default function AnimatedWalkthrough() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % screenshots.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isPlaying]);

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + screenshots.length) % screenshots.length);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % screenshots.length);
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-2xl bg-slate-800 border border-slate-700">
        <div className="relative aspect-video">
          {screenshots.map((screenshot, index) => (
            <div
              key={index}
              className={`absolute inset-0 transition-all duration-700 ease-in-out ${
                index === currentIndex
                  ? 'opacity-100 translate-x-0'
                  : index < currentIndex
                  ? 'opacity-0 -translate-x-full'
                  : 'opacity-0 translate-x-full'
              }`}
            >
              <img
                src={screenshot.src}
                alt={screenshot.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-transparent to-transparent" />
            </div>
          ))}
        </div>

        <button
          onClick={goToPrevious}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-900/70 text-white hover:bg-slate-900/90 transition-colors"
          aria-label="Previous slide"
        >
          <ChevronLeft size={24} />
        </button>

        <button
          onClick={goToNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-900/70 text-white hover:bg-slate-900/90 transition-colors"
          aria-label="Next slide"
        >
          <ChevronRight size={24} />
        </button>

        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="absolute top-4 right-4 p-2 rounded-full bg-slate-900/70 text-white hover:bg-slate-900/90 transition-colors"
          aria-label={isPlaying ? 'Pause slideshow' : 'Play slideshow'}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <div className="absolute bottom-0 left-0 right-0 p-6">
          <h3 className="text-2xl font-bold text-white mb-2">
            {screenshots[currentIndex].title}
          </h3>
          <p className="text-slate-300 max-w-2xl">
            {screenshots[currentIndex].description}
          </p>
        </div>
      </div>

      <div className="flex justify-center gap-2 mt-6">
        {screenshots.map((screenshot, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`group flex flex-col items-center gap-2 p-2 rounded-lg transition-all ${
              index === currentIndex
                ? 'bg-indigo-600/20'
                : 'hover:bg-slate-800'
            }`}
          >
            <div
              className={`w-16 h-10 rounded overflow-hidden border-2 transition-colors ${
                index === currentIndex
                  ? 'border-indigo-500'
                  : 'border-slate-700 group-hover:border-slate-600'
              }`}
            >
              <img
                src={screenshot.src}
                alt={screenshot.title}
                className="w-full h-full object-cover"
              />
            </div>
            <span
              className={`text-xs transition-colors ${
                index === currentIndex ? 'text-indigo-400' : 'text-slate-500'
              }`}
            >
              {screenshot.title.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex justify-center mt-4">
        <div className="flex gap-1">
          {screenshots.map((_, index) => (
            <div
              key={index}
              className={`h-1 rounded-full transition-all duration-300 ${
                index === currentIndex
                  ? 'w-8 bg-indigo-500'
                  : 'w-2 bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
