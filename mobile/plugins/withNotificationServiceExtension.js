/**
 * Expo config plugin: adds a Notification Service Extension (NSE) to the iOS build.
 *
 * The NSE intercepts push notifications before display and downloads the
 * vehicleImageUrl from the notification payload, attaching it as a banner
 * image. Without this, iOS cannot show images in push notification banners.
 *
 * Requires mutableContent: true in the Expo push message (set in fema_connector.py).
 */

const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins")
const path = require("path")
const fs = require("fs")
const os = require("os")

const NSE_TARGET = "NotificationServiceExtension"
const NSE_PROFILE_UUID = "123c5e4a-06a8-4df6-a11e-cf3004940328"

// App Store distribution provisioning profile for com.ambersangels.app.NotificationServiceExtension.
// Provisioning profiles contain no private keys — embedding is safe.
const NSE_PROFILE_B64 = "MIIvrwYJKoZIhvcNAQcCoIIvoDCCL5wCAQExCzAJBgUrDgMCGgUAMIIfvAYJKoZIhvcNAQcBoIIfrQSCH6k8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCI/Pgo8IURPQ1RZUEUgcGxpc3QgUFVCTElDICItLy9BcHBsZS8vRFREIFBMSVNUIDEuMC8vRU4iICJodHRwOi8vd3d3LmFwcGxlLmNvbS9EVERzL1Byb3BlcnR5TGlzdC0xLjAuZHRkIj4KPHBsaXN0IHZlcnNpb249IjEuMCI+CjxkaWN0PgoJPGtleT5BcHBJRE5hbWU8L2tleT4KCTxzdHJpbmc+QW1iZXJzIEFuZ2VscyBOb3RpZmljYXRpb24gU2VydmljZTwvc3RyaW5nPgoJPGtleT5BcHBsaWNhdGlvbklkZW50aWZpZXJQcmVmaXg8L2tleT4KCTxhcnJheT4KCTxzdHJpbmc+OVIzNE5XV1VIRDwvc3RyaW5nPgoJPC9hcnJheT4KCTxrZXk+Q3JlYXRpb25EYXRlPC9rZXk+Cgk8ZGF0ZT4yMDI2LTA3LTAyVDE0OjA1OjI0WjwvZGF0ZT4KCTxrZXk+UGxhdGZvcm08L2tleT4KCTxhcnJheT4KCQk8c3RyaW5nPmlPUzwvc3RyaW5nPgoJCTxzdHJpbmc+eHJPUzwvc3RyaW5nPgoJCTxzdHJpbmc+dmlzaW9uT1M8L3N0cmluZz4KCTwvYXJyYXk+Cgk8a2V5PklzWGNvZGVNYW5hZ2VkPC9rZXk+Cgk8ZmFsc2UvPgoJPGtleT5EZXZlbG9wZXJDZXJ0aWZpY2F0ZXM8L2tleT4KCTxhcnJheT4KCQk8ZGF0YT5NSUlGdHpDQ0JKK2dBd0lCQWdJUUpjdU1ybU0wa2t6TGJ5T0tNM3Z3Q1RBTkJna3Foa2lHOXcwQkFRc0ZBREIxTVVRd1FnWURWUVFERER0QmNIQnNaU0JYYjNKc1pIZHBaR1VnUkdWMlpXeHZjR1Z5SUZKbGJHRjBhVzl1Y3lCRFpYSjBhV1pwWTJGMGFXOXVJRUYxZEdodmNtbDBlVEVMTUFrR0ExVUVDd3dDUnpNeEV6QVJCZ05WQkFvTUNrRndjR3hsSUVsdVl5NHhDekFKQmdOVkJBWVRBbFZUTUI0WERUSTJNRFF3TmpFNE1qWXlNRm9YRFRJM01EUXdOakU0TWpZeE9Wb3dnWkl4R2pBWUJnb0praWFKay9Jc1pBRUJEQW81VWpNMFRsZFhWVWhFTVRrd053WURWUVFERERCcFVHaHZibVVnUkdsemRISnBZblYwYVc5dU9pQkhjbUZ1ZENCTWFXNWtZbVZ5WnlBb09WSXpORTVYVjFWSVJDa3hFekFSQmdOVkJBc01DamxTTXpST1YxZFZTRVF4RnpBVkJnTlZCQW9NRGtkeVlXNTBJRXhwYm1SaVpYSm5NUXN3Q1FZRFZRUUdFd0pWVXpDQ0FTSXdEUVlKS29aSWh2Y05BUUVCQlFBRGdnRVBBRENDQVFvQ2dnRUJBTllqTEcxRG8vTHprNWNPdFFxS2xWWnlRajkyd0gxWFBWNWhsVkx5cGFJM3FvcGtjTVJhZFNKZnJaM3Q2bHUvWTBDS3NvRTUwbmgvWHZPQk4wa3NTR0pQZUpTVVRQL3ZwaStWSHRCaXk2MnI2OWNPeWU4WjdBMTc1aVhYRWNmT3NmRDBVME5WQ2pKNkk3TlVEM1JsMWhDTUVrZ2ZDWG5DcWpEdTVIb1djRTdxQ1dUMUYzbkwrdm42ek9IQVlRZldPaTBFbCtJU2labUdxajlTcm1oSXVkTExVMSthdCt5WStmd3lPTGdtSnlHekhQTkRDaDRrWDJvbnFObzh4Mnk2a3AxUXJDeFlRT2JNQzVPTlBGQ1RJVEo0SkdWZVFFK0gvUkRITFo5dGhOZ3Jzb3IyazFld2l0dmpqZjl2VlpIYS9LUHNoWDRrbWpvVmgrb3gwZVVDVlIwQ0F3RUFBYU9DQWlNd2dnSWZNQXdHQTFVZEV3RUIvd1FDTUFBd0h3WURWUjBqQkJnd0ZvQVVDZjdBRlpENXIyUUtraEs1SmloakRKZnNwN0l3Y0FZSUt3WUJCUVVIQVFFRVpEQmlNQzBHQ0NzR0FRVUZCekFDaGlGb2RIUndPaTh2WTJWeWRITXVZWEJ3YkdVdVkyOXRMM2QzWkhKbk15NWtaWEl3TVFZSUt3WUJCUVVITUFHR0pXaDBkSEE2THk5dlkzTndMbUZ3Y0d4bExtTnZiUzl2WTNOd01ETXRkM2RrY21jek1ESXdnZ0VlQmdOVkhTQUVnZ0VWTUlJQkVUQ0NBUTBHQ1NxR1NJYjNZMlFGQVRDQi96Q0J3d1lJS3dZQkJRVUhBZ0l3Z2JZTWdiTlNaV3hwWVc1alpTQnZiaUIwYUdseklHTmxjblJwWm1sallYUmxJR0o1SUdGdWVTQndZWEowZVNCaGMzTjFiV1Z6SUdGalkyVndkR0Z1WTJVZ2IyWWdkR2hsSUhSb1pXNGdZWEJ3YkdsallXSnNaU0J6ZEdGdVpHRnlaQ0IwWlhKdGN5QmhibVFnWTI5dVpHbDBhVzl1Y3lCdlppQjFjMlVzSUdObGNuUnBabWxqWVhSbElIQnZiR2xqZVNCaGJtUWdZMlZ5ZEdsbWFXTmhkR2x2YmlCd2NtRmpkR2xqWlNCemRHRjBaVzFsYm5SekxqQTNCZ2dyQmdFRkJRY0NBUllyYUhSMGNITTZMeTkzZDNjdVlYQndiR1V1WTI5dEwyTmxjblJwWm1sallYUmxZWFYwYUc5eWFYUjVMekFXQmdOVkhTVUJBZjhFRERBS0JnZ3JCZ0VGQlFjREF6QWRCZ05WSFE0RUZnUVVmRXFhSmFIbHhhQVQ4M1l2MjlBSGVkNVVCSk13RGdZRFZSMFBBUUgvQkFRREFnZUFNQk1HQ2lxR1NJYjNZMlFHQVFRQkFmOEVBZ1VBTUEwR0NTcUdTSWIzRFFFQkN3VUFBNElCQVFCbkNjVVUrcTVsWFBkM2Vwc2hpdUp6NklRRjZVVzJWSXJnZE1teTllTUZnYWlQaUhKdEVaVThBd201N0VqSGw5TzEzUUt3b0k0Mm5nZEpsSFdQWTA1NE1DN1FpTVJ6VmE5U3ozRFNMVjN4b3p2SStnRUVBZmovYTU3TTFaL293Z2lOVDM3cWlPeUEvNlpjNjlmRW43OG54am55SE1sNytYWm52RG0vd3hsdHZoL2NBWGFsSlAzeGZiMUtlL1VMKzEwb0k1L2JHeGdWS0N4bnNFZUdaNnNwSHJudU9kRXc1SVhOK2FwY2M3Z3ZjeGQyd2N1SitXaDBheXltcDdtRUc0NU9RZFpLQW5IdVZuZGVYcGVzb2xTdVJHRlJHdmJrVkc3SUlBWGFLSlRJWjdaV1dZUnV1Z2xKd2dxZitPb09vTjZlbXQxOWRrWDhsVm1HZ0toa3puU0I8L2RhdGE+Cgk8L2FycmF5PgoKCTxrZXk+REVSLUVuY29kZWQtUHJvZmlsZTwva2V5PgoJPGRhdGE+TUlJTlRBWUpLb1pJaHZjTkFRY0NvSUlOUFRDQ0RUa0NBUUV4RFRBTEJnbGdoa2dCWlFNRUFnRXdnZ01MQmdrcWhraUc5dzBCQndHZ2dnTDhCSUlDK0RHQ0F2UXdEQXdIVm1WeWMybHZiZ0lCQVRBTkRBaFFVRkZEYUdWamF3RUJBREFRREFwVWFXMWxWRzlNYVhabEFnSUJGakFUREE1SmMxaGpiMlJsVFdGdVlXZGxaQUVCQURBVURBUk9ZVzFsREF4T1UwVWdRWEJ3VTNSdmNtVXdHZ3dJVkdWaGJVNWhiV1VNRGtkeVlXNTBJRXhwYm1SaVpYSm5NQjBNREVOeVpXRjBhVzl1UkdGMFpSY05Nall3TnpBeU1UUXdOVEkwV2pBZURBNVVaV0Z0U1dSbGJuUnBabWxsY2pBTURBbzVVak0wVGxkWFZVaEVNQjhNRGtWNGNHbHlZWFJwYjI1RVlYUmxGdzB5TnpBME1EWXhPREkyTVRsYU1DQU1GMUJ5YjJacGJHVkVhWE4wY21saWRYUnBiMjVVZVhCbERBVlRWRTlTUlRBaERBaFFiR0YwWm05eWJUQVZEQU5wVDFNTUJIaHlUMU1NQ0hacGMybHZiazlUTUNzTUcwRndjR3hwWTJGMGFXOXVTV1JsYm5ScFptbGxjbEJ5WldacGVEQU1EQW81VWpNMFRsZFhWVWhFTUN3TUJGVlZTVVFNSkRFeU0yTTFaVFJoTFRBMllUZ3ROR1JtTmkxaE1URmxMV05tTXpBd05EazBNRE15T0RBdkRBbEJjSEJKUkU1aGJXVU1Ja0Z0WW1WeWN5QkJibWRsYkhNZ1RtOTBhV1pwWTJGMGFXOXVJRk5sY25acFkyVXdPd3dWUkdWMlpXeHZjR1Z5UTJWeWRHbG1hV05oZEdWek1DSUVJRU02Y3Y1bUVPRThJSy9FenA3WVA4MXNsS1lQb3RhcmxKK1MwRVYxVVg0Uk1JSUJEQXdNUlc1MGFYUnNaVzFsYm5SemNJSDdBZ0VCc0lIMU1GWU1GbUZ3Y0d4cFkyRjBhVzl1TFdsa1pXNTBhV1pwWlhJTVBEbFNNelJPVjFkVlNFUXVZMjl0TG1GdFltVnljMkZ1WjJWc2N5NWhjSEF1VG05MGFXWnBZMkYwYVc5dVUyVnlkbWxqWlVWNGRHVnVjMmx2YmpBWURCTmlaWFJoTFhKbGNHOXlkSE10WVdOMGFYWmxBUUgvTURFTUkyTnZiUzVoY0hCc1pTNWtaWFpsYkc5d1pYSXVkR1ZoYlMxcFpHVnVkR2xtYVdWeURBbzVVak0wVGxkWFZVaEVNQk1NRG1kbGRDMTBZWE5yTFdGc2JHOTNBUUVBTURrTUZtdGxlV05vWVdsdUxXRmpZMlZ6Y3kxbmNtOTFjSE13SHd3TU9WSXpORTVYVjFWSVJDNHFEQTlqYjIwdVlYQndiR1V1ZEc5clpXNmdnZ2c5TUlJQ1F6Q0NBY21nQXdJQkFnSUlMY1g4aU5MRlM1VXdDZ1lJS29aSXpqMEVBd013WnpFYk1Ca0dBMVVFQXd3U1FYQndiR1VnVW05dmRDQkRRU0F0SUVjek1TWXdKQVlEVlFRTERCMUJjSEJzWlNCRFpYSjBhV1pwWTJGMGFXOXVJRUYxZEdodmNtbDBlVEVUTUJFR0ExVUVDZ3dLUVhCd2JHVWdTVzVqTGpFTE1Ba0dBMVVFQmhNQ1ZWTXdIaGNOTVRRd05ETXdNVGd4T1RBMldoY05Nemt3TkRNd01UZ3hPVEEyV2pCbk1Sc3dHUVlEVlFRRERCSkJjSEJzWlNCU2IyOTBJRU5CSUMwZ1J6TXhKakFrQmdOVkJBc01IVUZ3Y0d4bElFTmxjblJwWm1sallYUnBiMjRnUVhWMGFHOXlhWFI1TVJNd0VRWURWUVFLREFwQmNIQnNaU0JKYm1NdU1Rc3dDUVlEVlFRR0V3SlZVekIyTUJBR0J5cUdTTTQ5QWdFR0JTdUJCQUFpQTJJQUJKanBMejFBY3FUdGt5SnlnUk1jM1JDVjhjV2pUbkhjRkJiWkR1V21CU3AzWkh0ZlRqalR1eHhFdFgvMUg3WXlZbDNKNllSYlR6QlBFVm9BL1ZoWURLWDFEeXhOQjBjVGRkcVhsNWR2TVZ6dEs1MTdJRHZZdVZUWlhwbWtPbEVLTWFOQ01FQXdIUVlEVlIwT0JCWUVGTHV3M3FGWU00aWFwSXFaM3I2OTY2L2F5eVNyTUE4R0ExVWRFd0VCL3dRRk1BTUJBZjh3RGdZRFZSMFBBUUgvQkFRREFnRUdNQW9HQ0NxR1NNNDlCQU1EQTJnQU1HVUNNUUNENmNIRUZsNGFYVFFZMmUzdjlHd09BRVpMdU4reVJoSEZELzNtZW95aHBtdk93Z1BVblBXVHhuUzRhdCtxSXhVQ01HMW1paERLMUEzVVQ4Mk5RejYwaW1PbE0yN2piZG9YdDJRZnlGTW0rWWhpZERrTEYxdkxVYWdNNkJnRDU2S3lLRENDQXVZd2dnSnRvQU1DQVFJQ0NETU43dmkvVEdndU1Bb0dDQ3FHU000OUJBTURNR2N4R3pBWkJnTlZCQU1NRWtGd2NHeGxJRkp2YjNRZ1EwRWdMU0JITXpFbU1DUUdBMVVFQ3d3ZFFYQndiR1VnUTJWeWRHbG1hV05oZEdsdmJpQkJkWFJvYjNKcGRIa3hFekFSQmdOVkJBb01Da0Z3Y0d4bElFbHVZeTR4Q3pBSkJnTlZCQVlUQWxWVE1CNFhEVEUzTURJeU1qSXlNak15TWxvWERUTXlNREl4T0RBd01EQXdNRm93Y2pFbU1DUUdBMVVFQXd3ZFFYQndiR1VnVTNsemRHVnRJRWx1ZEdWbmNtRjBhVzl1SUVOQklEUXhKakFrQmdOVkJBc01IVUZ3Y0d4bElFTmxjblJwWm1sallYUnBiMjRnUVhWMGFHOXlhWFI1TVJNd0VRWURWUVFLREFwQmNIQnNaU0JKYm1NdU1Rc3dDUVlEVlFRR0V3SlZVekJaTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEEwSUFCQVpycEZadmZaOG4wYzQyanBJYlZzMVVObVJLeVpSb21mckpJSDdpOVZnUDNPSnE2eGxITHk3dk82UUJ0QUVUUkh4YUpxMmduQ2tsaXVYbUJtOVBmRnFqZ2Zjd2dmUXdEd1lEVlIwVEFRSC9CQVV3QXdFQi96QWZCZ05WSFNNRUdEQVdnQlM3c042aFdET0ltcVNLbWQ2K3ZldXYyc3NrcXpCR0JnZ3JCZ0VGQlFjQkFRUTZNRGd3TmdZSUt3WUJCUVVITUFHR0ttaDBkSEE2THk5dlkzTndMbUZ3Y0d4bExtTnZiUzl2WTNOd01ETXRZWEJ3YkdWeWIyOTBZMkZuTXpBM0JnTlZIUjhFTURBdU1DeWdLcUFvaGlab2RIUndPaTh2WTNKc0xtRndjR3hsTG1OdmJTOWhjSEJzWlhKdmIzUmpZV2N6TG1OeWJEQWRCZ05WSFE0RUZnUVVla2U2T0lvVkpFZ2lSczIranhva2V6UURLbWt3RGdZRFZSMFBBUUgvQkFRREFnRUdNQkFHQ2lxR1NJYjNZMlFHQWhFRUFnVUFNQW9HQ0NxR1NNNDlCQU1EQTJjQU1HUUNNQlVNcVk3R3I1WnBhNmVmM1Z6VUExbHNybExVWU1hTGR1QzN4YUx4Q1h6Z211TnJzZU44TWNRbmVxZU9pZjJyZHdJd1lUTWc4U24vK1ljeXJpbklaRDEyZTFHazBnSXZkcjVnSXBIeDFUcDEzTFRpeGlxVy9zWUozRXBQMVNUdy9NcXlNSUlEQ0RDQ0FxMmdBd0lCQWdJSWRBdytPZVdTcW1Bd0NnWUlLb1pJemowRUF3SXdjakVtTUNRR0ExVUVBd3dkUVhCd2JHVWdVM2x6ZEdWdElFbHVkR1ZuY21GMGFXOXVJRU5CSURReEpqQWtCZ05WQkFzTUhVRndjR3hsSUVObGNuUnBabWxqWVhScGIyNGdRWFYwYUc5eWFYUjVNUk13RVFZRFZRUUtEQXBCY0hCc1pTQkpibU11TVFzd0NRWURWUVFHRXdKVlV6QWVGdzB5TmpBeE1qRXhPVEkzTWpCYUZ3MHpNREF5TVRreE9USTNNVGxhTUU0eEtqQW9CZ05WQkFNTUlWZFhSRklnVUhKdmRtbHphVzl1YVc1bklGQnliMlpwYkdVZ1UybG5ibWx1WnpFVE1CRUdBMVVFQ2d3S1FYQndiR1VnU1c1akxqRUxNQWtHQTFVRUJoTUNWVk13V1RBVEJnY3Foa2pPUFFJQkJnZ3Foa2pPUFFNQkJ3TkNBQVNRQ20rSno5T0JnREJVdGJzNnB3dXByeW0yRWRGdmsrMis4MG5hZVhIdWFwMmJoOEZSL2lUeURYalFOYnRLSVdPT0JORy9wcnFPcjV2NDBJUU9mVkU0bzRJQlR6Q0NBVXN3REFZRFZSMFRBUUgvQkFJd0FEQWZCZ05WSFNNRUdEQVdnQlI2UjdvNGloVWtTQ0pHemI2UEdpUjdOQU1xYVRCQkJnZ3JCZ0VGQlFjQkFRUTFNRE13TVFZSUt3WUJCUVVITUFHR0pXaDBkSEE2THk5dlkzTndMbUZ3Y0d4bExtTnZiUzl2WTNOd01ETXRZWE5wWTJFME1ETXdnWllHQTFVZElBU0JqakNCaXpDQmlBWUpLb1pJaHZkalpBVUJNSHN3ZVFZSUt3WUJCUVVIQWdJd2JReHJWR2hwY3lCalpYSjBhV1pwWTJGMFpTQnBjeUIwYnlCaVpTQjFjMlZrSUdWNFkyeDFjMmwyWld4NUlHWnZjaUJtZFc1amRHbHZibk1nYVc1MFpYSnVZV3dnZEc4Z1FYQndiR1VnVUhKdlpIVmpkSE1nWVc1a0wyOXlJRUZ3Y0d4bElIQnliMk5sYzNObGN5NHdIUVlEVlIwT0JCWUVGT09SNFlsMEFXYWtoKzcvczFTTDNURkx4Vi9RTUE0R0ExVWREd0VCL3dRRUF3SUhnREFQQmdrcWhraUc5Mk5rREJNRUFnVUFNQW9HQ0NxR1NNNDlCQU1DQTBrQU1FWUNJUUNLTEFuNG5ra1JOQ2ZyZXVCQ0IrTmhNbi95aFJxUG5GQXEyRjJCM0Iwc1ZRSWhBT0ZWbmJ6NmYzYVRpYzdETTZERER5azY5Wnp3a0MvWlgwOTRRbmoxTWR6VU1ZSUIwekNDQWM4Q0FRRXdmakJ5TVNZd0pBWURWUVFEREIxQmNIQnNaU0JUZVhOMFpXMGdTVzUwWldkeVlYUnBiMjRnUTBFZ05ERW1NQ1FHQTFVRUN3d2RRWEJ3YkdVZ1EyVnlkR2xtYVdOaGRHbHZiaUJCZFhSb2IzSnBkSGt4RXpBUkJnTlZCQW9NQ2tGd2NHeGxJRWx1WXk0eEN6QUpCZ05WQkFZVEFsVlRBZ2gwREQ0NTVaS3FZREFMQmdsZ2hrZ0JaUU1FQWdHZ2dlY3dHQVlKS29aSWh2Y05BUWtETVFzR0NTcUdTSWIzRFFFSEFUQWNCZ2txaGtpRzl3MEJDUVV4RHhjTk1qWXdOekF5TVRRd05USTBXakFvQmdrcWhraUc5dzBCQ1RReEd6QVpNQXNHQ1dDR1NBRmxBd1FDQWFFS0JnZ3Foa2pPUFFRREFqQXZCZ2txaGtpRzl3MEJDUVF4SWdRZ09ObVNpd2VCUXJxVVU0cG9NZWZZMUlveDM5aHc1MFljRjA2VXUxdUI0dDh3VWdZSktvWklodmNOQVFrUE1VVXdRekFLQmdncWhraUc5dzBEQnpBT0JnZ3Foa2lHOXcwREFnSUNBSUF3RFFZSUtvWklodmNOQXdJQ0FVQXdCd1lGS3c0REFnY3dEUVlJS29aSWh2Y05Bd0lDQVNnd0NnWUlLb1pJemowRUF3SUVSekJGQWlCY01RcmhMdlFvcFcrSE4wc0RBUVpGMFFzQk5yQ24waDFDL1A5aFFtUXNCd0loQUtINTcxY3R4WHcvWklLV05XemxzZXRBM00ybDVxeEdEUVlXNEQwOWJxWjY8L2RhdGE+CgkJCQkJCQkJCQkJCQoJCQk8a2V5PlBQUUNoZWNrPC9rZXk+Cgk8ZmFsc2UvPgoKCTxrZXk+RW50aXRsZW1lbnRzPC9rZXk+Cgk8ZGljdD4KCQk8a2V5PmJldGEtcmVwb3J0cy1hY3RpdmU8L2tleT4KCQk8dHJ1ZS8+CgkJCQkKCQkJCTxrZXk+YXBwbGljYXRpb24taWRlbnRpZmllcjwva2V5PgoJCTxzdHJpbmc+OVIzNE5XV1VIRC5jb20uYW1iZXJzYW5nZWxzLmFwcC5Ob3RpZmljYXRpb25TZXJ2aWNlRXh0ZW5zaW9uPC9zdHJpbmc+CgkJCQkKCQkJCTxrZXk+a2V5Y2hhaW4tYWNjZXNzLWdyb3Vwczwva2V5PgoJCTxhcnJheT4KCQkJCTxzdHJpbmc+OVIzNE5XV1VIRC4qPC9zdHJpbmc+CgkJCQk8c3RyaW5nPmNvbS5hcHBsZS50b2tlbjwvc3RyaW5nPgoJCTwvYXJyYXk+CgkJCQkKCQkJCTxrZXk+Z2V0LXRhc2stYWxsb3c8L2tleT4KCQk8ZmFsc2UvPgoJCQkJCgkJCQk8a2V5PmNvbS5hcHBsZS5kZXZlbG9wZXIudGVhbS1pZGVudGlmaWVyPC9rZXk+CgkJPHN0cmluZz45UjM0TldXVUhEPC9zdHJpbmc+CgkJCgk8L2RpY3Q+Cgk8a2V5PkV4cGlyYXRpb25EYXRlPC9rZXk+Cgk8ZGF0ZT4yMDI3LTA0LTA2VDE4OjI2OjE5WjwvZGF0ZT4KCTxrZXk+TmFtZTwva2V5PgoJPHN0cmluZz5OU0UgQXBwU3RvcmU8L3N0cmluZz4KCTxrZXk+VGVhbUlkZW50aWZpZXI8L2tleT4KCTxhcnJheT4KCQk8c3RyaW5nPjlSMzROV1dVSEQ8L3N0cmluZz4KCTwvYXJyYXk+Cgk8a2V5PlRlYW1OYW1lPC9rZXk+Cgk8c3RyaW5nPkdyYW50IExpbmRiZXJnPC9zdHJpbmc+Cgk8a2V5PlRpbWVUb0xpdmU8L2tleT4KCTxpbnRlZ2VyPjI3ODwvaW50ZWdlcj4KCTxrZXk+VVVJRDwva2V5PgoJPHN0cmluZz4xMjNjNWU0YS0wNmE4LTRkZjYtYTExZS1jZjMwMDQ5NDAzMjg8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"

const SWIFT_SOURCE = `import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard
            let content = bestAttemptContent,
            // Expo promotes data keys to top-level in the APNs payload
            let urlString = content.userInfo["vehicleImageUrl"] as? String,
            let url = URL(string: urlString)
        else {
            contentHandler(request.content)
            return
        }

        URLSession.shared.downloadTask(with: url) { [weak self] location, _, _ in
            guard let self, let location else {
                contentHandler(request.content)
                return
            }
            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("jpg")
            do {
                try FileManager.default.moveItem(at: location, to: tmp)
                let attachment = try UNNotificationAttachment(identifier: "vehicle", url: tmp)
                content.attachments = [attachment]
            } catch {}
            contentHandler(content)
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let content = bestAttemptContent {
            handler(content)
        }
    }
}
`

function buildInfoPlist(bundleId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>${bundleId}</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.usernotifications.service</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
    </dict>
</dict>
</plist>
`
}

// Xcode 14+ signs resource bundle targets by default, which breaks builds when
// those bundles don't have a development team. Patch the generated Podfile to
// opt resource bundle targets out of code signing.
function withPodfileResourceBundleFix(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = require("path").join(cfg.modRequest.platformProjectRoot, "Podfile")
      let podfile = require("fs").readFileSync(podfilePath, "utf8")

      const fix = `
  installer.pods_project.targets.each do |target|
    if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      end
    end
  end
`
      // Append inside the existing post_install block that Expo always generates
      if (!podfile.includes("CODE_SIGNING_ALLOWED")) {
        podfile = podfile.replace(
          /^(post_install do \|installer\|)/m,
          `$1\n${fix}`
        )
        require("fs").writeFileSync(podfilePath, podfile, "utf8")
      }
      return cfg
    },
  ])
}

// Install the NSE provisioning profile into ~/Library/MobileDevice/Provisioning Profiles/
// before Xcode runs. EAS uses manual signing and won't provision the NSE bundle ID
// automatically, so we carry the profile in the plugin and install it ourselves.
function withNSEProvisioning(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const profilesDir = path.join(
        os.homedir(),
        "Library",
        "MobileDevice",
        "Provisioning Profiles"
      )
      fs.mkdirSync(profilesDir, { recursive: true })
      const dest = path.join(profilesDir, `${NSE_PROFILE_UUID}.mobileprovision`)
      fs.writeFileSync(dest, Buffer.from(NSE_PROFILE_B64, "base64"))
      return cfg
    },
  ])
}

// Write Swift source + Info.plist into the ios/ project directory during pre-build
function withNSEFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const nseDir = path.join(cfg.modRequest.platformProjectRoot, NSE_TARGET)
      const nseBundleId = `${cfg.ios.bundleIdentifier}.${NSE_TARGET}`
      fs.mkdirSync(nseDir, { recursive: true })
      fs.writeFileSync(path.join(nseDir, "NotificationService.swift"), SWIFT_SOURCE, "utf8")
      // CFBundleIdentifier is a literal — EAS's xcconfig overrides PRODUCT_BUNDLE_IDENTIFIER
      // for all targets, which would set it to the parent app's ID and fail validation.
      fs.writeFileSync(path.join(nseDir, "Info.plist"), buildInfoPlist(nseBundleId), "utf8")
      return cfg
    },
  ])
}

// Add the NSE target to the Xcode project
function withNSETarget(config) {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults
    const bundleId = cfg.ios.bundleIdentifier
    const nseBundleId = `${bundleId}.${NSE_TARGET}`
    const deploymentTarget = cfg.ios.deploymentTarget || "15.1"

    // Idempotent — skip if already added
    if (proj.pbxTargetByName(NSE_TARGET)) return cfg

    // Snapshot XCBuildConfiguration UUIDs BEFORE addTarget so we can diff
    // afterwards to find exactly which configs belong to the new NSE target.
    const objects = proj.hash.project.objects
    const buildConfigs = objects["XCBuildConfiguration"] || {}
    const beforeUuids = new Set(
      Object.keys(buildConfigs).filter((k) => !k.endsWith("_comment"))
    )

    // Create the extension target
    const target = proj.addTarget(NSE_TARGET, "app_extension", NSE_TARGET)

    // Build phases
    proj.addBuildPhase(
      ["NotificationService.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid
    )
    proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid)
    proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid)

    // File group in the Xcode navigator
    const groupResult = proj.addPbxGroup(
      ["NotificationService.swift", "Info.plist"],
      NSE_TARGET,
      NSE_TARGET
    )
    const mainGroupKey = proj.findPBXGroupKey({ name: cfg.modRequest.projectName })
    if (mainGroupKey && groupResult?.uuid) {
      proj.addToPbxGroup(groupResult.uuid, mainGroupKey)
    }

    // Diff: new UUIDs added by addTarget are the NSE's Debug + Release configs.
    // Re-read from objects in case addTarget replaced the section reference.
    const buildConfigsAfter = objects["XCBuildConfiguration"] || {}
    const nseConfigUuids = Object.keys(buildConfigsAfter).filter(
      (k) => !k.endsWith("_comment") && !beforeUuids.has(k)
    )

    if (nseConfigUuids.length === 0) {
      throw new Error(
        `withNotificationServiceExtension: addTarget created no new XCBuildConfiguration entries ` +
        `(beforeUuids: ${beforeUuids.size}). Cannot set PRODUCT_BUNDLE_IDENTIFIER.`
      )
    }

    for (const uuid of nseConfigUuids) {
      if (buildConfigsAfter[uuid]?.buildSettings !== undefined) {
        Object.assign(buildConfigsAfter[uuid].buildSettings, {
          CODE_SIGN_STYLE: "Manual",
          CODE_SIGN_IDENTITY: '"iPhone Distribution"',
          DEVELOPMENT_TEAM: "9R34NWWUHD",
          INFOPLIST_FILE: `${NSE_TARGET}/Info.plist`,
          IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
          PRODUCT_BUNDLE_IDENTIFIER: nseBundleId,
          PROVISIONING_PROFILE_SPECIFIER: NSE_PROFILE_UUID,
          SKIP_INSTALL: "YES",
          SWIFT_VERSION: "5.0",
          TARGETED_DEVICE_FAMILY: '"1,2"',
        })
      }
    }

    return cfg
  })
}

module.exports = function withNotificationServiceExtension(config) {
  config = withNSEProvisioning(config)
  config = withNSEFiles(config)
  config = withNSETarget(config)
  config = withPodfileResourceBundleFix(config)
  return config
}
