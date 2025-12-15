import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { Player } from "@/components/player";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { ThemeColorManager } from "@/components/theme-color-manager";
import { QueueSidebar } from "@/components/queue-sidebar";

export const metadata: Metadata = {
  title: "st0rmMusic Player",
  description: "A local music player",
  icons: {
    icon: [
      { url: '/favicon.png', sizes: 'any' },
      { url: '/favicon32.png', sizes: '32x32' }
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeColorManager />
          <SidebarProvider className="h-full overflow-hidden">
            <AppSidebar />
            <SidebarInset className="flex-1 overflow-y-auto overflow-x-hidden relative h-full bg-background text-foreground block">
              <div className="flex flex-col min-h-full w-full">
                <div className="p-4 sticky top-0 z-50 flex items-center gap-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <SidebarTrigger className="-ml-1" />
                  <Separator orientation="vertical" className="h-4" />
                  <ModeToggle />
                </div>
                {children}
                {/* Spacer to allow scrolling past the fixed player */}
                <div className="h-32 pointer-events-none shrink-0 w-full" />
              </div>
            </SidebarInset>
            <QueueSidebar />
          </SidebarProvider>
          <Player />
        </ThemeProvider>
      </body>
    </html>
  );
}
