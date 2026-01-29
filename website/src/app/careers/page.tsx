import Link from 'next/link';
import { 
  Heart, Coffee, Laptop, Plane, GraduationCap, Wallet,
  MapPin, ArrowRight
} from 'lucide-react';

const benefits = [
  { icon: Heart, title: 'Health & Wellness', description: 'Comprehensive medical, dental, and vision coverage for you and your family.' },
  { icon: Coffee, title: 'Flexible Work', description: 'Remote-first culture with flexible hours and unlimited PTO.' },
  { icon: Laptop, title: 'Equipment Budget', description: '$2,500 to set up your ideal home office workspace.' },
  { icon: Plane, title: 'Team Offsites', description: 'Quarterly team gatherings in exciting locations worldwide.' },
  { icon: GraduationCap, title: 'Learning Budget', description: '$1,500 annual budget for courses, conferences, and books.' },
  { icon: Wallet, title: 'Competitive Comp', description: 'Top-tier salary plus meaningful equity in a growing company.' },
];

const positions = [
  {
    title: 'Senior Backend Engineer',
    department: 'Engineering',
    location: 'Remote (US/EU)',
    type: 'Full-time',
  },
  {
    title: 'Product Designer',
    department: 'Design',
    location: 'Remote (US)',
    type: 'Full-time',
  },
  {
    title: 'Solutions Engineer',
    department: 'Sales',
    location: 'New York, NY',
    type: 'Full-time',
  },
  {
    title: 'Customer Success Manager',
    department: 'Customer Success',
    location: 'Remote (US)',
    type: 'Full-time',
  },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen py-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            Join the <span className="gradient-text">ComplyVerse</span> Team
          </h1>
          <p className="text-lg text-slate-300">
            Help us build the future of enterprise compliance. We're looking for passionate people who want to make a difference.
          </p>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-white mb-4">Our Culture</h2>
              <p className="text-slate-300 mb-4">
                At ComplyVerse, we believe in building a company where talented people can do their best work. We're remote-first, async-friendly, and obsessed with outcomes over hours.
              </p>
              <p className="text-slate-300">
                We value transparency, continuous learning, and taking ownership. Every team member has a voice, and the best ideas win regardless of where they come from.
              </p>
            </div>
            <div className="bg-slate-700/50 rounded-xl aspect-video flex items-center justify-center">
              <span className="text-slate-500 text-lg">Team Photo</span>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Benefits & Perks</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            We take care of our team so they can focus on building amazing products.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {benefits.map((benefit) => (
            <div
              key={benefit.title}
              className="bg-slate-800 p-6 rounded-xl border border-slate-700"
            >
              <div className="w-12 h-12 bg-indigo-500/20 rounded-lg flex items-center justify-center mb-4">
                <benefit.icon className="h-6 w-6 text-indigo-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{benefit.title}</h3>
              <p className="text-slate-400 text-sm">{benefit.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white mb-4">Open Positions</h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Find your next opportunity and help shape the future of GRC.
          </p>
        </div>
        <div className="space-y-4">
          {positions.map((position) => (
            <div
              key={position.title}
              className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-indigo-500/50 transition-colors"
            >
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">{position.title}</h3>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-slate-400">{position.department}</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400 flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {position.location}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-slate-400">{position.type}</span>
                </div>
              </div>
              <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 whitespace-nowrap">
                Apply Now
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-slate-400 mb-4">
            Don't see a role that fits? We're always looking for talented people.
          </p>
          <Link
            href="/contact"
            className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
          >
            Send us your resume →
          </Link>
        </div>
      </section>
    </div>
  );
}
