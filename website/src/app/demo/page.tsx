'use client';

import { useState } from 'react';
import { Play, Monitor, Shield, FileCheck, AlertTriangle } from 'lucide-react';

const screenshots = [
  { title: 'Dashboard Overview', description: 'Real-time compliance status across all frameworks', icon: Monitor },
  { title: 'Control Library', description: 'Unified view of controls mapped across frameworks', icon: Shield },
  { title: 'Evidence Management', description: 'AI-powered evidence collection and assessment', icon: FileCheck },
  { title: 'Risk Register', description: 'Complete enterprise risk management view', icon: AlertTriangle },
];

export default function DemoPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Experience <span className="gradient-text">ComplyVerse</span>
          </h1>
          <p className="text-lg text-slate-300">
            Watch our platform in action and discover how AI-powered compliance can transform your GRC operations.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="aspect-video bg-slate-700/50 flex items-center justify-center relative group cursor-pointer">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-purple-600/20" />
            <div className="relative z-10 text-center">
              <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <Play className="h-8 w-8 text-white ml-1" />
              </div>
              <p className="text-white font-medium">Watch Product Demo</p>
              <p className="text-slate-400 text-sm">3 min overview</p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <h2 className="text-3xl font-bold text-white text-center mb-12">Platform Screenshots</h2>
        <div className="grid md:grid-cols-2 gap-8">
          {screenshots.map((screenshot) => (
            <div
              key={screenshot.title}
              className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden group hover:border-indigo-500/50 transition-colors"
            >
              <div className="aspect-video bg-slate-700/50 flex items-center justify-center">
                <screenshot.icon className="h-16 w-16 text-slate-600 group-hover:text-indigo-500/50 transition-colors" />
              </div>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-white mb-2">{screenshot.title}</h3>
                <p className="text-slate-400 text-sm">{screenshot.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8">
          <h2 className="text-2xl font-bold text-white text-center mb-2">Request a Personalized Demo</h2>
          <p className="text-slate-400 text-center mb-8">
            See how ComplyVerse can address your specific compliance challenges.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Work Email
                </label>
                <input
                  type="email"
                  id="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="john@company.com"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="company" className="block text-sm font-medium text-slate-300 mb-2">
                  Company Name
                </label>
                <input
                  type="text"
                  id="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="Acme Inc"
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-300 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium text-slate-300 mb-2">
                What are your compliance challenges?
              </label>
              <textarea
                id="message"
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                placeholder="Tell us about your current compliance environment and challenges..."
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition-colors"
            >
              Request Demo
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
