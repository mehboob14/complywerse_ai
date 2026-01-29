'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle } from 'lucide-react';
import AnimatedWalkthrough from '@/components/AnimatedWalkthrough';

export default function DemoPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, formType: 'demo' }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to submit');
      }
      
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again or email us directly.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-16">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Experience <span className="gradient-text">ComplyVerse</span>
          </h1>
          <p className="text-lg text-slate-300">
            Explore our platform with this interactive walkthrough. See how AI-powered compliance management transforms your GRC operations.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <h2 className="text-2xl font-bold text-white text-center mb-8">Interactive Platform Walkthrough</h2>
        <AnimatedWalkthrough />
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 rounded-2xl border border-indigo-500/30 p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white mb-4">
                See the Full Platform in Action
              </h2>
              <p className="text-slate-300 mb-6">
                The walkthrough above shows key features, but there's so much more to discover. Schedule a personalized demo to see:
              </p>
              <ul className="space-y-3">
                {[
                  'Custom framework configuration for your industry',
                  'AI-powered evidence assessment in real-time',
                  'Advanced risk analytics and reporting',
                  'Integration capabilities with your existing tools',
                  'Multi-tenant setup for enterprise organizations',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-slate-300">
                    <CheckCircle className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-800/80 rounded-xl p-6 border border-slate-700">
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">Thank You!</h3>
                  <p className="text-slate-400">
                    We've received your demo request. Our team will reach out within 24 hours to schedule your personalized demonstration.
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-semibold text-white mb-4">Request a Personalized Demo</h3>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="Full Name"
                        required
                      />
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="Work Email"
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="text"
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        className="px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="Company"
                        required
                      />
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                        placeholder="Phone (optional)"
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                      placeholder="Tell us about your compliance needs..."
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <span>Submitting...</span>
                      ) : (
                        <>
                          <span>Schedule Demo</span>
                          <ArrowRight size={18} />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Have Questions?</h2>
          <p className="text-slate-400 mb-6">
            Our compliance experts are ready to discuss how ComplyVerse can address your specific requirements.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <span>Contact our team</span>
            <ArrowRight size={18} />
          </a>
        </div>
      </section>
    </div>
  );
}
