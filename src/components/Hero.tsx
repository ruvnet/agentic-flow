import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, Brain, Rocket } from 'lucide-react';

const Hero = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6 py-20 overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-secondary/20 rounded-full blur-3xl animate-pulse-glow animation-delay-1000" />
      </div>

      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="text-center space-y-8 animate-fade-in">
          {/* Badges */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="px-4 py-2 bg-primary/10 border border-primary/30 rounded-full text-sm font-medium">
              v1.7.1
            </span>
            <span className="px-4 py-2 bg-secondary/10 border border-secondary/30 rounded-full text-sm font-medium">
              MIT License
            </span>
            <span className="px-4 py-2 bg-accent/10 border border-accent/30 rounded-full text-sm font-medium">
              Node.js 18+
            </span>
          </div>

          {/* Main Title */}
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            <span className="text-gradient">Agentic Flow</span>
            <br />
            <span className="text-foreground/90 text-3xl md:text-5xl">
              AI Agents That Learn & Evolve
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
            The first AI agent framework that gets{' '}
            <span className="text-primary font-semibold">smarter</span> AND{' '}
            <span className="text-secondary font-semibold">faster</span> every time it runs
          </p>

          {/* Key Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto pt-8">
            <div className="bg-card/50 backdrop-blur-sm border border-border rounded-2xl p-6 hover:shadow-glow transition-smooth hover:scale-105">
              <Zap className="w-12 h-12 text-secondary mx-auto mb-3" />
              <div className="text-4xl font-bold text-gradient">352x</div>
              <div className="text-sm text-muted-foreground mt-2">Faster Code Operations</div>
            </div>
            <div className="bg-card/50 backdrop-blur-sm border border-border rounded-2xl p-6 hover:shadow-glow transition-smooth hover:scale-105">
              <Brain className="w-12 h-12 text-primary mx-auto mb-3" />
              <div className="text-4xl font-bold text-gradient">90%+</div>
              <div className="text-sm text-muted-foreground mt-2">Success Rate After Learning</div>
            </div>
            <div className="bg-card/50 backdrop-blur-sm border border-border rounded-2xl p-6 hover:shadow-glow transition-smooth hover:scale-105">
              <Rocket className="w-12 h-12 text-accent mx-auto mb-3" />
              <div className="text-4xl font-bold text-gradient">$0</div>
              <div className="text-sm text-muted-foreground mt-2">Cost Per Edit</div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <Link
              to="/betting"
              className="px-8 py-4 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl transition-smooth hover:scale-105 w-full sm:w-auto text-center text-lg"
            >
              ⚽ Sports Betting Dashboard
            </Link>
            <button className="px-8 py-4 bg-gradient-primary text-foreground font-semibold rounded-xl hover:shadow-primary transition-smooth hover:scale-105 w-full sm:w-auto">
              Get Started
            </button>
            <button className="px-8 py-4 bg-card border border-border text-foreground font-semibold rounded-xl hover:shadow-glow transition-smooth hover:scale-105 w-full sm:w-auto">
              View on GitHub
            </button>
          </div>

          {/* Installation Command */}
          <div className="bg-background-light border border-border rounded-xl p-6 max-w-2xl mx-auto mt-8">
            <code className="text-sm md:text-base text-primary font-mono">
              npm install -g agentic-flow
            </code>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
