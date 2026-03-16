import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, email, subject, message } = body

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const timestamp = new Date().toISOString()

    console.log("[Contact Request]", {
      name,
      email,
      subject,
      message,
      timestamp,
    })

    // TODO: If CONTACT_EMAIL env var is set, send an email via Resend/SendGrid
    // const contactEmail = process.env.CONTACT_EMAIL
    // if (contactEmail) {
    //   await sendEmail({ to: contactEmail, from: email, subject, body: message })
    // }

    return NextResponse.json(
      { success: true, message: "Message received" },
      { status: 200 }
    )
  } catch (error) {
    console.error("[Contact Route Error]", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
