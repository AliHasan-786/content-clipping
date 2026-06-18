"use client"

import { VideoUploader } from "@/components/ui/video-uploader"
import { VideoMetadata } from "@/components/ui/video-card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Video, Sparkles, Upload, Clock, Users } from "lucide-react"
import Link from "next/link"

export default function UploadPage() {
  const handleUploadComplete = (video: VideoMetadata) => {
    console.log('Upload completed:', video)
    // Could show a success notification here
  }

  const handleVideoSelect = (video: VideoMetadata) => {
    console.log('Video selected:', video)
    // Could navigate to the video editor or player
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Navigation */}
      <nav className="border-b border-border/40 bg-white/50 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
              
              <div className="flex items-center space-x-2">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
                  <Video className="h-5 w-5" />
                </div>
                <span className="font-bold text-xl text-foreground">ClipMaster</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                Help
              </Button>
              <Button variant="outline">Sign In</Button>
              <Button>Get Started</Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Header Section */}
      <div className="bg-gradient-to-r from-primary/10 via-purple-50 to-primary/10 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
          <div className="text-center max-w-3xl mx-auto">
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 mb-4 sm:mb-6">
              <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary text-primary-foreground">
                <Upload className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">
                Upload Your Videos
              </h1>
            </div>
            
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground mb-6 sm:mb-8 leading-relaxed px-4 sm:px-0">
              Transform your long-form content into engaging clips. Upload your videos and let our AI-powered tools help you create perfect clips for social media.
            </p>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mt-8 sm:mt-12 px-4 sm:px-0">
              <div className="bg-white/60 backdrop-blur border rounded-lg p-6 text-center">
                <div className="flex items-center justify-center mb-3">
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <Clock className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground mb-1">2 min</div>
                <div className="text-sm text-muted-foreground">Average upload time</div>
              </div>
              
              <div className="bg-white/60 backdrop-blur border rounded-lg p-6 text-center">
                <div className="flex items-center justify-center mb-3">
                  <div className="bg-green-100 p-3 rounded-lg">
                    <Sparkles className="h-6 w-6 text-green-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground mb-1">AI-Powered</div>
                <div className="text-sm text-muted-foreground">Smart clip detection</div>
              </div>
              
              <div className="bg-white/60 backdrop-blur border rounded-lg p-6 text-center">
                <div className="flex items-center justify-center mb-3">
                  <div className="bg-purple-100 p-3 rounded-lg">
                    <Users className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground mb-1">500+</div>
                <div className="text-sm text-muted-foreground">Creators trust us</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
        <VideoUploader
          onUploadComplete={handleUploadComplete}
          onVideoSelect={handleVideoSelect}
          maxFiles={10}
          maxFileSize={2 * 1024 * 1024 * 1024} // 2GB
        />
      </main>

      {/* Tips Section */}
      <div className="bg-slate-50 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 lg:py-16">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2 sm:mb-4">
              Pro Tips for Better Results
            </h2>
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-4 sm:px-0">
              Get the most out of your video uploads with these best practices
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8">
            {[
              {
                title: "High Quality Source",
                description: "Upload videos in the highest quality available. We'll optimize them for different platforms.",
                icon: "🎥"
              },
              {
                title: "Clear Audio",
                description: "Good audio quality is crucial for automatic transcription and clip detection.",
                icon: "🎵"
              },
              {
                title: "Structured Content",
                description: "Videos with clear segments and topics work best for automatic clip generation.",
                icon: "📊"
              },
              {
                title: "Engaging Moments",
                description: "Content with natural peaks and highlights will produce the best clips.",
                icon: "✨"
              }
            ].map((tip, index) => (
              <div key={index} className="bg-white border rounded-lg p-6 text-center hover:shadow-md transition-shadow">
                <div className="text-3xl mb-4">{tip.icon}</div>
                <h3 className="font-semibold text-foreground mb-2">{tip.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {tip.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

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
  )
}