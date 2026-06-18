import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, Upload, Scissors, Download, Play, Shield, Zap } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Navigation */}
      <nav className="border-b border-border/40 bg-white/50 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
                <Video className="h-5 w-5" />
              </div>
              <span className="font-bold text-xl text-foreground">ClipMaster</span>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                Features
              </Button>
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                Pricing
              </Button>
              <Button variant="outline">Sign In</Button>
              <Button asChild>
                <Link href="/upload">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-24">
        <div className="max-w-7xl mx-auto text-center">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-6xl sm:text-7xl font-bold tracking-tight text-slate-900 mb-8">
              Create
              <span className="text-primary"> stunning clips</span>
              <br />
              from your videos
            </h1>
            <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed">
              Transform your long-form content into engaging clips with our AI-powered video editor. 
              Perfect for content creators, marketers, and social media enthusiasts.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Button size="lg" className="text-lg px-8 py-6" asChild>
                <Link href="/upload">
                  <Upload className="mr-2 h-5 w-5" />
                  Upload Your Video
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="text-lg px-8 py-6">
                <Play className="mr-2 h-5 w-5" />
                Watch Demo
              </Button>
            </div>

            {/* Feature Cards */}
            <div className="grid md:grid-cols-3 gap-8 mt-20">
              <Card className="border-0 shadow-lg bg-white/60 backdrop-blur">
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-primary">
                    <Upload className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-xl">Easy Upload</CardTitle>
                  <CardDescription className="text-base">
                    Drag and drop your videos or browse to upload. Support for all major formats.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-0 shadow-lg bg-white/60 backdrop-blur">
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-600">
                    <Scissors className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-xl">Smart Clipping</CardTitle>
                  <CardDescription className="text-base">
                    AI-powered scene detection and one-click trimming for perfect clips every time.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-0 shadow-lg bg-white/60 backdrop-blur">
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                    <Download className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-xl">Export Ready</CardTitle>
                  <CardDescription className="text-base">
                    Download in multiple formats optimized for different social platforms.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold text-white mb-2">10K+</div>
              <div className="text-slate-300">Videos Processed</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-white mb-2">500+</div>
              <div className="text-slate-300">Happy Creators</div>
            </div>
            <div>
              <div className="text-4xl font-bold text-white mb-2">99.9%</div>
              <div className="text-slate-300">Uptime</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              Everything you need to create amazing clips
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Professional-grade features designed specifically for content creators
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: <Zap className="h-6 w-6" />,
                title: "Lightning Fast",
                description: "Process videos in seconds, not minutes. Our optimized pipeline ensures quick turnaround times."
              },
              {
                icon: <Shield className="h-6 w-6" />,
                title: "Secure & Private",
                description: "Your content is encrypted and processed securely. We never store or share your videos."
              },
              {
                icon: <Video className="h-6 w-6" />,
                title: "Multiple Formats",
                description: "Support for MP4, MOV, AVI, and more. Export in the format that works best for your platform."
              }
            ].map((feature, index) => (
              <Card key={index} className="border-0 shadow-sm">
                <CardHeader>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground mb-4">
                    {feature.icon}
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-primary">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-primary-foreground mb-4">
            Ready to start creating?
          </h2>
          <p className="text-xl text-primary-foreground/90 mb-8">
            Join thousands of creators who trust ClipMaster for their video editing needs.
          </p>
          <Button size="lg" variant="secondary" className="text-lg px-8 py-6" asChild>
            <Link href="/upload">
              <Upload className="mr-2 h-5 w-5" />
              Start Creating Now
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-white">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary text-primary-foreground">
                <Video className="h-4 w-4" />
              </div>
              <span className="font-semibold text-foreground">ClipMaster</span>
            </div>
            <div className="text-sm text-muted-foreground">
              © 2024 ClipMaster. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
