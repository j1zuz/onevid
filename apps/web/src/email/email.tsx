import {
  Body,
  Button,
  Column,
  Container,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

const heroBackgroundImage = [
  "radial-gradient(ellipse 130% 120% at 0% 0%, rgba(251, 191, 36, 0.85) 0%, rgba(253, 186, 116, 0.5) 35%, transparent 60%)",
  "radial-gradient(ellipse 130% 120% at 100% 0%, rgba(139, 92, 246, 0.75) 0%, rgba(125, 211, 252, 0.45) 40%, transparent 65%)",
  "radial-gradient(ellipse 120% 110% at 100% 100%, rgba(52, 211, 153, 0.7) 0%, rgba(167, 243, 208, 0.35) 40%, transparent 65%)",
  "radial-gradient(ellipse 110% 100% at 0% 100%, rgba(251, 207, 232, 0.6) 0%, transparent 55%)",
  "radial-gradient(ellipse 60% 55% at 50% 45%, rgba(255, 255, 255, 0.65) 0%, transparent 70%)",
].join(", ");

interface EmailStrings {
  body: string;
  button: string;
  greeting: (name: string) => string;
  langAttr: string;
  preview: string;
  subject: string;
}

const EMAIL_STRINGS: Record<string, EmailStrings> = {
  "es-419": {
    preview: "Tu enlace para iniciar sesión",
    greeting: (name) => `Hola${name ? ` ${name}` : ""},`,
    body: "Has solicitado un enlace para iniciar sesión. Para continuar, haz clic en el botón siguiente:",
    button: "Iniciar sesión",
    subject: "Tu enlace para iniciar sesión",
    langAttr: "es",
  },
  "es-ES": {
    preview: "Tu enlace para iniciar sesión",
    greeting: (name) => `Hola${name ? ` ${name}` : ""},`,
    body: "Has solicitado un enlace para iniciar sesión. Para continuar, haz clic en el botón siguiente:",
    button: "Iniciar sesión",
    subject: "Tu enlace para iniciar sesión",
    langAttr: "es",
  },
  "en-US": {
    preview: "Your sign-in link",
    greeting: (name) => `Hi${name ? ` ${name}` : ""},`,
    body: "You requested a sign-in link. To continue, click the button below:",
    button: "Sign in",
    subject: "Your sign-in link",
    langAttr: "en",
  },
  "de-DE": {
    preview: "Dein Anmeldelink",
    greeting: (name) => `Hallo${name ? ` ${name}` : ""},`,
    body: "Du hast einen Anmeldelink angefordert. Um fortzufahren, klicke auf die Schaltfläche unten:",
    button: "Anmelden",
    subject: "Dein Anmeldelink",
    langAttr: "de",
  },
  "fr-FR": {
    preview: "Votre lien de connexion",
    greeting: (name) => `Bonjour${name ? ` ${name}` : ""},`,
    body: "Vous avez demandé un lien de connexion. Pour continuer, cliquez sur le bouton ci-dessous :",
    button: "Se connecter",
    subject: "Votre lien de connexion",
    langAttr: "fr",
  },
  "pt-BR": {
    preview: "Seu link de acesso",
    greeting: (name) => `Olá${name ? ` ${name}` : ""},`,
    body: "Você solicitou um link de acesso. Para continuar, clique no botão abaixo:",
    button: "Entrar",
    subject: "Seu link de acesso",
    langAttr: "pt",
  },
  "it-IT": {
    preview: "Il tuo link di accesso",
    greeting: (name) => `Ciao${name ? ` ${name}` : ""},`,
    body: "Hai richiesto un link di accesso. Per continuare, fai clic sul pulsante in basso:",
    button: "Accedi",
    subject: "Il tuo link di accesso",
    langAttr: "it",
  },
  "ja-JP": {
    preview: "サインインリンク",
    greeting: (name) => `こんにちは${name ? `、${name}` : ""},`,
    body: "サインインリンクをリクエストしました。続けるには、以下のボタンをクリックしてください：",
    button: "サインイン",
    subject: "サインインリンク",
    langAttr: "ja",
  },
  "ko-KR": {
    preview: "로그인 링크",
    greeting: (name) => `안녕하세요${name ? ` ${name}` : ""},`,
    body: "로그인 링크를 요청하셨습니다. 계속하려면 아래 버튼을 클릭하세요:",
    button: "로그인",
    subject: "로그인 링크",
    langAttr: "ko",
  },
  "hi-IN": {
    preview: "आपका साइन-इन लिंक",
    greeting: (name) => `नमस्ते${name ? ` ${name}` : ""},`,
    body: "आपने साइन-इन लिंक अनुरोध किया है। जारी रखने के लिए नीचे दिए गए बटन पर क्लिक करें:",
    button: "साइन इन करें",
    subject: "आपका साइन-इन लिंक",
    langAttr: "hi",
  },
  "id-ID": {
    preview: "Tautan masuk Anda",
    greeting: (name) => `Halo${name ? ` ${name}` : ""},`,
    body: "Anda meminta tautan masuk. Untuk melanjutkan, klik tombol di bawah:",
    button: "Masuk",
    subject: "Tautan masuk Anda",
    langAttr: "id",
  },
  "nl-NL": {
    preview: "Jouw inloglink",
    greeting: (name) => `Hallo${name ? ` ${name}` : ""},`,
    body: "Je hebt een inloglink aangevraagd. Klik op de knop hieronder om verder te gaan:",
    button: "Inloggen",
    subject: "Jouw inloglink",
    langAttr: "nl",
  },
  "ru-RU": {
    preview: "Ссылка для входа",
    greeting: (name) => `Здравствуйте${name ? `, ${name}` : ""},`,
    body: "Вы запросили ссылку для входа. Чтобы продолжить, нажмите на кнопку ниже:",
    button: "Войти",
    subject: "Ссылка для входа",
    langAttr: "ru",
  },
  "tr-TR": {
    preview: "Giriş bağlantınız",
    greeting: (name) => `Merhaba${name ? ` ${name}` : ""},`,
    body: "Giriş bağlantısı talep ettiniz. Devam etmek için aşağıdaki düğmeye tıklayın:",
    button: "Giriş yap",
    subject: "Giriş bağlantınız",
    langAttr: "tr",
  },
};

function logoImageSrc(): string {
  return `${process.env.BASE_URL}/logo.png`;
}

const PLUS_SUFFIX_REGEX = /\+.*/;

function greetingFromEmail(email: string): string {
  let local = email.trim().split("@")[0]?.trim() ?? "";
  if (!local) {
    return "";
  }
  local = local.replace(PLUS_SUFFIX_REGEX, "");
  return local.charAt(0).toUpperCase() + local.slice(1);
}

interface MagicLinkEmailProps {
  email?: string;
  locale?: string;
  url: string;
}

export const MagicLinkEmail = ({
  url,
  email = "",
  locale = "es-419",
}: MagicLinkEmailProps) => {
  const strings = EMAIL_STRINGS[locale] ?? EMAIL_STRINGS["es-419"];
  const who = greetingFromEmail(email);

  return (
    <Html lang={strings.langAttr}>
      <Preview>{strings.preview}</Preview>
      <Tailwind>
        <Body className="m-0 w-full bg-[#fafafa] p-0 font-sans text-[#171717] [line-height:1.6]">
          <Container className="mx-auto max-w-[480px] border border-neutral-200 border-solid bg-white text-center">
            <Section
              className="m-0 w-full bg-white px-6 pt-10 pb-7"
              style={{ backgroundImage: heroBackgroundImage }}
            >
              <Row>
                <Column align="center" className="w-full">
                  <Img
                    alt="onevid"
                    className="mx-auto block border-0"
                    height={32}
                    src={logoImageSrc()}
                    width={32}
                  />
                </Column>
              </Row>
            </Section>

            <Section className="m-0 bg-white px-6 pt-3 pb-2 text-left">
              <Text className="m-0 mb-4 p-0 text-neutral-600 text-sm leading-normal">
                {strings.greeting(who)}
              </Text>
              <Text className="m-0 mb-4 text-neutral-600 text-sm leading-normal">
                {strings.body}
              </Text>
            </Section>

            <Section className="m-0 px-6 pt-0 pb-5 text-center">
              <Button
                className="inline-block rounded-[8px] border-2 border-white border-solid bg-neutral-900 px-10 py-3 text-center font-semibold text-sm text-white"
                href={url}
              >
                {strings.button}
              </Button>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default MagicLinkEmail;

export async function renderMagicLinkEmail(
  url: string,
  email: string,
  locale = "es-419"
): Promise<{ html: string; subject: string }> {
  const strings = EMAIL_STRINGS[locale] ?? EMAIL_STRINGS["es-419"];
  const html = await render(MagicLinkEmail({ url, email, locale }));
  return { html, subject: strings.subject };
}

interface PinResetEmailProps {
  code: string;
  email?: string;
}

export const PinResetEmail = ({ code, email = "" }: PinResetEmailProps) => {
  const who = greetingFromEmail(email);

  return (
    <Html lang="es">
      <Preview>Código para restablecer el PIN de tu perfil</Preview>
      <Tailwind>
        <Body className="m-0 w-full bg-[#fafafa] p-0 font-sans text-[#171717] [line-height:1.6]">
          <Container className="mx-auto max-w-[480px] border border-neutral-200 border-solid bg-white text-center">
            <Section
              className="m-0 w-full bg-white px-6 pt-10 pb-7"
              style={{ backgroundImage: heroBackgroundImage }}
            >
              <Row>
                <Column align="center" className="w-full">
                  <Img
                    alt="onevid"
                    className="mx-auto block border-0"
                    height={32}
                    src={logoImageSrc()}
                    width={32}
                  />
                </Column>
              </Row>
            </Section>

            <Section className="m-0 bg-white px-6 pt-3 pb-2 text-left">
              <Text className="m-0 mb-4 p-0 text-neutral-600 text-sm leading-normal">
                Hola{who ? ` ${who}` : ""},
              </Text>
              <Text className="m-0 mb-4 text-neutral-600 text-sm leading-normal">
                Usa este código para restablecer el PIN de tu perfil principal.
                Caduca en 10 minutos. Si no lo solicitaste, ignora este correo.
              </Text>
            </Section>

            <Section className="m-0 px-6 pt-0 pb-6 text-center">
              <Text className="m-0 inline-block rounded-[8px] bg-neutral-100 px-8 py-3 text-center font-bold text-3xl text-neutral-900 tracking-[0.4em]">
                {code}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export async function renderPinResetEmail(
  code: string,
  email: string
): Promise<{ html: string; subject: string }> {
  const html = await render(PinResetEmail({ code, email }));
  return { html, subject: "Código para restablecer tu PIN" };
}
