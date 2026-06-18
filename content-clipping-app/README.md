# ClipMaster - Content Clipping Application

A modern Next.js 14 application for creating and managing video clips with a professional interface designed for content creators.

## Features

- ✨ Modern, responsive UI with Tailwind CSS
- 🎥 Video upload and processing
- ✂️ Smart video clipping tools
- 🔐 Authentication with NextAuth.js
- 🗄️ PostgreSQL database with Prisma ORM
- 📱 Mobile-first responsive design
- 🎨 Beautiful landing page with hero section

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives
- **Database**: PostgreSQL with Prisma
- **Authentication**: NextAuth.js
- **Icons**: Lucide React

## Project Structure

```
content-clipping-app/
├── src/
│   └── app/
│       ├── api/
│       │   └── auth/
│       │       └── [...nextauth]/
│       │           └── route.ts
│       ├── globals.css
│       ├── layout.tsx
│       └── page.tsx
├── components/
│   └── ui/
│       ├── button.tsx
│       ├── card.tsx
│       └── input.tsx
├── lib/
│   ├── auth.ts
│   ├── prisma.ts
│   └── utils.ts
├── types/
│   └── index.ts
├── prisma/
│   └── schema.prisma
├── .env.local
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

### 1. Environment Setup

Copy the environment variables from `.env.local` and update them:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/content_clipping_db?schema=public"

# NextAuth.js
NEXTAUTH_SECRET="your-nextauth-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# Optional OAuth Providers
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_ID=""
GITHUB_SECRET=""
```

### 2. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Push the schema to your database
npm run db:push

# Or run migrations (recommended for production)
npm run db:migrate
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Run database migrations
- `npm run db:studio` - Open Prisma Studio
- `npm run db:reset` - Reset database

## Database Schema

The application includes the following models:

- **User**: User accounts with authentication
- **Video**: Uploaded video files with metadata
- **Clip**: Video clips created from source videos
- **Account/Session**: NextAuth.js authentication tables

## Authentication

The app supports multiple authentication methods:

- **Credentials**: Email/password authentication
- **OAuth**: Google and GitHub (configure in environment variables)

## UI Components

Built with a custom component library based on Radix UI:

- Button with multiple variants
- Card components for content layout
- Input fields with proper styling
- Responsive navigation
- Professional color scheme

## Deployment

1. Set up a PostgreSQL database (Vercel Postgres, Supabase, etc.)
2. Update environment variables
3. Run database migrations
4. Deploy to Vercel, Netlify, or your preferred platform

## Next Steps

1. Set up your database connection
2. Configure authentication providers
3. Implement video upload functionality
4. Add video processing logic
5. Build the clipping interface

## Contributing

This is a foundational setup. Feel free to extend with additional features like:

- Video processing with FFmpeg
- Cloud storage integration
- Advanced clipping tools
- Social media export formats
- User dashboard and analytics

## License

This project is created for demonstration purposes. Use as a starting point for your content creation platform.