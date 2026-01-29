import { Target, Eye, Users, Lightbulb, Heart, Shield, Zap } from 'lucide-react';

const team = [
  { name: 'Sarah Chen', role: 'CEO & Co-Founder', image: null },
  { name: 'Michael Roberts', role: 'CTO & Co-Founder', image: null },
  { name: 'Emily Thompson', role: 'Chief Product Officer', image: null },
  { name: 'David Kim', role: 'Chief Revenue Officer', image: null },
];

const values = [
  {
    icon: Lightbulb,
    title: 'Innovation First',
    description: 'We push the boundaries of what\'s possible in GRC technology.',
  },
  {
    icon: Users,
    title: 'Customer Obsessed',
    description: 'Every decision starts with how it impacts our customers.',
  },
  {
    icon: Heart,
    title: 'Integrity Always',
    description: 'We build trust through transparency and ethical practices.',
  },
  {
    icon: Zap,
    title: 'Move Fast',
    description: 'We ship early, iterate often, and continuously improve.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            About <span className="gradient-text">ComplyVerse</span>
          </h1>
          <p className="text-lg text-slate-300">
            We're on a mission to transform how enterprises approach governance, risk, and compliance.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="grid md:grid-cols-2 gap-12">
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700">
            <div className="w-14 h-14 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-6">
              <Target className="h-7 w-7 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Our Mission</h2>
            <p className="text-slate-300 text-lg">
              To democratize enterprise compliance by making sophisticated GRC capabilities accessible to organizations of all sizes.
            </p>
          </div>
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700">
            <div className="w-14 h-14 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-6">
              <Eye className="h-7 w-7 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Our Vision</h2>
            <p className="text-slate-300 text-lg">
              A world where compliance enables growth rather than hindering it, where security and innovation go hand in hand.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Our Story</h2>
        </div>
        <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-3xl mx-auto">
          <p className="text-slate-300 mb-4">
            ComplyVerse was founded in 2023 by a team of compliance professionals and engineers who experienced firsthand the frustrations of managing compliance with legacy tools.
          </p>
          <p className="text-slate-300 mb-4">
            After years of working with spreadsheets, disconnected systems, and manual processes, we knew there had to be a better way. We set out to build the GRC platform we always wished existed.
          </p>
          <p className="text-slate-300">
            Today, ComplyVerse helps enterprises across financial services, healthcare, technology, and energy sectors manage their compliance programs with unprecedented efficiency and intelligence.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Our Values</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            The principles that guide everything we do.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {values.map((value) => (
            <div
              key={value.title}
              className="bg-slate-800 p-6 rounded-xl border border-slate-700 text-center"
            >
              <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mx-auto mb-4">
                <value.icon className="h-6 w-6 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{value.title}</h3>
              <p className="text-slate-400 text-sm">{value.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Leadership Team</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Experienced leaders driving innovation in GRC technology.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {team.map((member) => (
            <div
              key={member.name}
              className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden text-center"
            >
              <div className="aspect-square bg-slate-700/50 flex items-center justify-center">
                <Shield className="h-16 w-16 text-slate-600" />
              </div>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-white mb-1">{member.name}</h3>
                <p className="text-slate-400 text-sm">{member.role}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
