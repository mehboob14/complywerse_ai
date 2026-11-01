import { redirect } from "next/navigation";

// Home is dropped — the native Dashboard is the single Help Desk landing page.
// Kept as a redirect so any existing /helpdesk/home link lands on the dashboard
// instead of 404ing.
export default function HelpDeskHomeRedirect() {
  redirect("/helpdesk/dashboard");
}
